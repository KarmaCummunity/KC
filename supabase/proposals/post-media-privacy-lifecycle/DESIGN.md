# Post media privacy and deletion lifecycle — design for review (KC#2316, Item 2)

Status: **design, implemented phase by phase** (§6 records what is in place). Nothing in this file
changes storage policies, buckets or data; each phase ships as its own migration, reviewed and tested.

Scope: (1) who can read an uploaded original; (2) how deletion (photo removed, post deleted, account
purged) reaches every stored object, including objects written late; (3) durable cleanup for
`chat-media` and `avatars`, which today have no server reconciliation.

## 1. Current state (from code on this branch)

| Object | Bucket / path | Readable by | Removed by |
| --- | --- | --- | --- |
| Post photo original (member upload) | `post-images` (public) `<owner>/<batch>/<n>.jpg` | anyone with the URL, also after its copy is ready | orphan job when unreferenced and > 1 day old; account purge (`<owner>/`) |
| Client thumb of the original | `post-images` `<owner>/…-thumb.jpg` | anyone with the URL | same |
| Post photo original, private (phase 3a; the app moves with a release) | `post-uploads` (private) `<owner>/<batch>/<n>.jpg` (+ `-thumb`) | its owner (signed URL) and the service role | orphan job when unreferenced and > 1 day old; account purge (`<owner>/`) |
| Server copy + thumb (candidate) | `post-images` `derived/<owner>/<media>-a<n>.jpg` | anyone with the URL | orphan job when unreferenced; account purge (`derived/<owner>/`) |
| Chat image | `chat-media` (private) `<sender>/<chat>/<uuid>.jpg` | chat members (signed URL) | account purge; app ledger (best effort); **no server orphan job** |
| Avatar generation | `avatars` (public) `<user>/avatar-<uuid>.jpg` | anyone with the URL | account purge; app ledger + profile re-read (best effort); **no server orphan job** |

What holds today, and what does not:

- **Holds:** other members' reads go through `post_media` (RLS) and only `ready` rows, which point at
  server copies. The `derived/` namespace accepts no client writes (restrictive policies). The account
  purge removes both member prefixes, and defers while a photo job of the member still holds a lease.
- **Does not hold:**
  - Originals are public bytes. Hiding their key is not access control.
  - Every object is served with `public, max-age=31536000, immutable`, so a URL that was ever handed
    out stays fetchable from caches after the object is deleted. A public, immutable CDN URL **cannot be
    revoked** from the database.
  - "No writes after deletion" is only application-level (worker leases and aborted requests).
    Storage may commit an aborted request later, and no owner or tombstone check runs when Storage
    commits a write.
  - The cancelled job rows are deleted by the account's cascade, so they are no durable deletion
    record. The app ledger is per device and best effort.

## 2. Requirements to choose against

- **R1 Original privacy.** An unsanitized original is never readable by anyone but its owner and the
  server, not even through a guessed or leaked URL.
- **R2 Eventual deletion.** After a deletion event, every object it covers, including one written
  after the event, is removed. Completion is recorded only after a **verified absence**: a listing
  after every writer is known to be quiescent.
- **R3 Revocation latency.** Stated per object class: "immediate" requires an access gate, and
  "eventual" accepts cache lifetime.
- **R4 No future writes.** After a deletion intent, writes into the covered paths are refused **at
  storage-commit time**, not only avoided by well-behaved clients.
- **R5 Cost and performance.** The feed stays CDN-cacheable; no per-image database round trip on the
  hot path unless chosen.
- **R6 Rollout safety.** No backfill or mass change without a separate decision; existing URLs keep
  working until a migration of them is decided.

## 3. Originals (R1, R3)

**A. Private upload bucket (recommended).** New private bucket `post-uploads`: members insert into
their own folder; no public read. The worker reads with the service role and writes copies to the
public `post-images/derived/`.
- Pros: originals are never public; the copies stay CDN-cacheable.
- Cons: app change — upload target, owner previews via short-lived signed URLs, the owner pending-cover
  fallback switches to signed URLs. Existing public originals are untouched until a separate
  migration decision.

**B. Delete the original once its copy is `ready`.**
- Pros: smallest change.
- Cons: originals are public until processed (minutes to hours, unbounded if processing fails);
  URLs already handed out stay cached; edit and republish flows lose the source.
- Does not meet R1.

**C. Access gate for every image.** Proxy or signed URLs with short TTL for all reads.
- Pros: meets R3 "immediate" for every object.
- Cons: per-request cost and latency on the feed; CDN caching needs care; largest change.

**Design default: A.** It is the baseline, not an open architecture question.
- Copies stay public; their revocation is "eventual (cache lifetime)".
- **C** applies only to object classes that need immediate revocation; that list is a product decision (§8).

## 4. Deletion lifecycle (R2, R4)

**Deletion intent (non-cascading).** A table such as `kc_private.storage_deletion_intents(id, bucket,
prefix_or_key, reason, created_at, not_before, attempts, last_listing_at, verified_absent_at)`. It has
**no foreign key** to users, posts or media, so it survives every cascade.
- Written in the same transaction as the event:
  - account purge prepare: every member prefix, including `derived/<uid>/`;
  - post deletion: its keys, copies and thumbs;
  - photo removal in `replace_post_media`: the removed keys.
- Stores no personal data beyond the path. A user id inside a path is kept only until
  `verified_absent_at`, then the row is reduced or deleted. Retention is to be decided with privacy
  review.

**Inventory and verified re-sweep.** A service reconciler takes due intents:
1. list the prefix or keys (Storage list, or `storage.objects`);
2. delete them;
3. **list again**.

An intent completes only when `now() >= not_before` and the second listing is empty.
`not_before` = event time + max worker lease + max upload deadline + a settle margin.
- A finite settle margin **cannot prove** that no write will still commit. An empty listing only
  shows that nothing has committed *yet*.
- Calling an intent "verified absent" therefore also needs storage commit-bound evidence: either a
  vendor-documented, enforced maximum request lifetime after which an upload can no longer commit,
  or the commit-time refusal below.
- Without that evidence, completion means "absent at the last sweep". The reconciler keeps
  re-sweeping open prefixes on a schedule, and the guarantee is stated as eventual, not proven.
- Otherwise it retries with back-off and alerts after N attempts.
- This replaces "the orphan job will catch it" as the deletion guarantee. The orphan job stays as a
  general safety net.

**Commit-time authorization (R4).**
- *Member writes:* storage insert policies should authorize against the member's **current** account
  state and any open deletion intent for the path, in addition to the folder check. Exact predicate
  to be reviewed privately with the PM before it is written.
- *Service writes* (the worker) bypass RLS, so no commit-time policy can refuse them. Options:
  1. accept "eventual" for service writes and rely on the verified re-sweep above (not R4);
  2. route service writes through a database-authorized step: e.g. the worker first records the key
     it will write, and the reconciler deletes any `derived/` object without such a record or with a
     cancelled one;
  3. signed upload URLs issued by a database function that refuses to issue them under an open intent.

  **Option 3 is unproven as a commit-time refusal.** A check at issuance is not revocation: a URL
  issued before the intent stays usable until it expires, unless the vendor documents and enforces
  revocation or re-authorization at commit. R4 for service writes therefore needs one of:
  - **(a)** a vendor-verified commit-time check, documented by the vendor and tested against live
    storage-api on DEV; or
  - **(b)** a **guarded private proxy**: only a server component holds write credentials to the
    origin; it re-checks the open intents in the same database transaction that records the write,
    immediately before forwarding each write, and is the only writer.

  Until one of these is in place, service writes stay "eventual" under §4's re-sweep.

## 5. Durable chat-media and avatars cleanup

- **Avatars:** an object is referenced iff it equals `users.avatar_url` (or that object's `-thumb`
  sibling). Extend `kc_private.storage_orphan_keys` to `avatars` with that rule and the same minimum
  age, and add the bucket to the reconciler. Cheap, and covers lost device ledgers.
- **Chat media:** an object is referenced iff a message stores its path. This needs an indexed lookup
  of message media paths (e.g. a generated column or a small `chat_media_refs` table filled by the
  send function). Then the same orphan rule applies. Signed-URL reads already gate access; deletion of
  a whole chat or account becomes an intent (§4).
- Alternative for both: server-issued **signed upload URLs** that record every object in an inventory
  at issue time; the reconciler then compares the inventory with references. This is the strongest
  inventory, but changes every upload path.

## 6. Proposed phases (each separately reviewed, tested first, no backfill implied)

1. **Intents + verified re-sweep** for account purge only (non-cascading table, reconciler,
   `not_before`), pgTAP and handler tests including a late write after the first sweep.
   *Implemented (2026-11-25):* `kc_private.storage_deletion_intents`, written by
   `account_purge_finish`; swept by `purge-deleted-accounts` (`sweep.ts`); quiet window 1 hour;
   closed intents pruned after 7 days. Runbook: "Storage deletion intents".
2. **Avatars orphan reconciliation** (§5), pgTAP for the reference rule, purge-compatible.
   *Implemented (2026-11-28):* `kc_private.storage_orphan_keys` answers for `avatars` (referenced iff a
   `users.avatar_url` points at the object or it is that object's `-thumb`, via
   `kc_private.avatar_object_key`, read inside the security-definer rule: an expression index on
   `public.users` would run that function with the rights of every member editing their own row);
   `reconcile-storage-orphans` judges `avatars`.
3. **Private upload bucket** (§3 A) behind an app release; the worker reads from it; copies unchanged.
   *3a, server side, implemented (2026-11-28):* private bucket `post-uploads` (member insert, read
   and delete in their own folder only); `post_media_processing.source_bucket`; the claim names the
   original's bucket and completion moves the row to `post-images/derived/`; `replace_post_media` takes
   a bucket per item; the orphan rule judges `post-uploads` and matches a job's original by bucket.
   Backward compatible: `post-images` uploads behave as before.
   *Open:* 3b, the app (upload target, owner previews through signed URLs, republish copy; needs a
   release); 3c, the WhatsApp bot's uploads; then closing `post-images` to member uploads once the
   release has rolled out.
4. **Commit-time authorization** for member writes (§4), then the chosen option for service writes.
5. **Chat-media references + reconciliation** (§5).
6. Decide separately: migration of existing public originals, avatar retention, and which classes need
   immediate revocation (§3 C).

## 7. What this branch does not guarantee (for the record)

The current patch series provides application-level bounds (leases, aborts, deferral, self-cleanup,
device ledger) and a client write fence on `derived/`. It does **not** provide R1, R2-verified, R3
immediate or R4 for service writes. None of its behaviour is measured against live Supabase Storage,
and no platform resource measurement exists.

## 8. Product questions for later (retention and cost only)

- Which object classes need immediate revocation (the access-gate cost of §3 C).
- How long originals are retained after processing (edit/republish needs vs storage cost).
- Whether existing public originals are migrated into the private bucket, given its one-time cost.

Engineering items are not owner questions: they are verified on DEV and reviewed. They include the
private upload bucket default, commit-time evidence or the guarded proxy, and the reconciler cadence.
