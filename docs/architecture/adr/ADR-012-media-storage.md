# ADR-012 — Media and storage: KC's own object store, the same paths, the same policies

- **Status:** Accepted (2026-11-23) · phase 7 of [ADR-009](./ADR-009-backend-platform.md)
- **Decision log:** `D-248` in [`../../SSOT/DECISIONS.md`](../../SSOT/DECISIONS.md)
- **Related:** [ADR-010 port gateway](./ADR-010-port-gateway.md), [ADR-011 realtime gateway](./ADR-011-realtime-gateway.md) (the same principle, applied to realtime)

## Context

The app keeps three kinds of files in Supabase Storage: profile pictures (`avatars`, public), post photos (`post-images`, public, with server-made copies under `derived/`), and chat attachments (`chat-media`, private). Who may write, read or delete a file is row-level security on `storage.objects`, by bucket and path: a member writes under their own folder, a chat attachment is readable by the chat's members, and nobody but the server touches `derived/`.

What uses Storage today:

- The app uploads straight to Storage, shows public files by URL, asks for a signed URL to show a chat attachment, and deletes its own files (an old avatar, an abandoned upload).
- One port method copies files (`post.republish`), and six Edge Functions read or write files: the three media functions (sanitized copies and thumbnails of post photos), the account purge, the storage reconciliation, and the WhatsApp webhook (photos members send).

Leaving Supabase means replacing the service that stores the bytes. As with realtime, two things must survive: the paths the app and the database already use, and the rule that **authorization lives in SQL next to the data**.

## Decision

### 1. Bytes in Google Cloud Storage, behind one interface

One `ObjectStore` interface in the API (put, get, delete, copy, list, signed read URL, signed upload URL, public URL). Two implementations: Google Cloud Storage for the deployed API, and a local directory for development and tests, so every flow below is tested without a cloud account. A bucket of today maps to a bucket of the same purpose; the object names do not change.

### 2. `storage.objects` stays, as KC's index of its files

On KC's own PostgreSQL the `storage` schema (the tables `buckets` and `objects`, and `storage.foldername`) is KC's, as the `realtime` schema is. A row of `storage.objects` is the record that a file exists, with its size and type. The SQL that already reads the table (the reconciliation, the purge, the media jobs) keeps working, and the bucket rules (`public`, `file_size_limit`, `allowed_mime_types`) keep living in `storage.buckets`.

### 3. Authorization is the policies already written

- **Upload:** the caller may upload `<bucket>/<name>` when they could insert that row into `storage.objects`. The API tries the insert as the caller in a transaction that is rolled back; the restrictive policies (nobody writes under `derived/`) apply because they are policies.
- **Read of a private file:** the caller may get a signed URL when they could select the object's row.
- **Delete:** the caller may delete when they could delete the row.

A bucket's size limit and allowed types are checked by the API before a signed upload URL is issued, and enforced by the store on the upload itself. A name holds one object for good (the index has one row per bucket and name, as the service being replaced does): the app already gives every upload attempt its own path, so nothing is ever replaced under a URL someone holds.

### 4. How the app moves files

| Today | With KC's API |
|---|---|
| Upload to Storage with the member's token | Ask the API for a signed upload URL for `<bucket>/<name>` (authorized as above), upload the bytes to the store with it, then tell the API the upload is complete; the API checks the stored object (size, type) and writes the `storage.objects` row |
| Public URL of an avatar or post photo | The same address shape on KC's media domain (CDN in front of the public buckets): `<host>/storage/v1/object/public/<bucket>/<name>`. Only the host changes |
| Signed URL of a chat attachment | Ask the API; it authorizes and returns a short-lived signed URL of the store |
| Delete own file | Ask the API; it authorizes, deletes the object and its row |

The app's upload and URL helpers go through one storage door, as data goes through `viaApi` and channels through `viaApiRealtime`: with no API configured they keep using Supabase Storage.

**The public address keeps its shape.** A member's `avatar_url` is stored in the database as a full address, and the app reads a file's path back out of such an address. So KC's media domain serves public files under the path they have today, and the app recognises an address by that path, not by its host: an address written before the move still names the same file. At the switch the stored addresses get the new host in one update (a prefix replacement), and the load balancer maps the path to the bucket.

**No resizing on request.** Supabase Storage can resize an image per request (a paid add-on the app opts in to per build). KC's store does not: it serves the copies the server writes at upload (the thumbnail beside every photo), which is what the app already shows by default.

**A signed address is also the app's "is it still there".** The app asks for one to learn whether an upload it remembers still exists, so the API answers `404` for a file that is not in the index, after the right to read it was established.

Bytes never pass through the API on upload or download: it issues URLs and keeps the index. That keeps the API small and lets the store and the CDN do what they are built for.

### 5. Server-side work on files

The six functions are ported like the others (ADR-009 phase 8), written against `ObjectStore`. `post.republish` is a hosted adapter, so it is not ported: the server gives the adapter's client a `storage` member backed by `ObjectStore` and the index, as it gave it a database (ADR-010) and channels (ADR-011). Image work (the sanitized copy and thumbnails) runs as a job in the API's process at first; if its CPU cost shows in the API's latency it moves to its own Cloud Run job without changing the code that calls it. Video is not stored today; when the product adds it (the long-horizon vision), it gets a transcoding pipeline of its own and an ADR.

### 6. Moving the existing files

Before the switch, every object is copied to the new store by name and verified by size and checksum, in a job that can be re-run. The index rows are copied with the database (phase 10). Until the switch the copy is repeated for new objects; after it, Supabase Storage is read-only and then removed.

## Order of work

| Step | What | State |
|---|---|---|
| 1 | Storage authorizer on the real policies (upload, read, delete) | Done (`apps/api/src/platform/storage/storageAuthorizer.ts`): each bucket's rule has a case for the member it is for and for another, on the KC schema; asking stores no row |
| 2 | `ObjectStore` with the local-directory implementation; upload, signed read and delete routes; the index row | Done (`platform/storage`): `POST /v1/storage/uploads` (grant), `/uploads/complete` (index row, written as the member), `/signed-urls`, `/objects/delete`. A name is written once and never replaced; a grant fixes the type and the largest size; a confirmation checks the stored object against the bucket's rules again; a member who may not write a name can neither confirm nor remove another member's upload. The local store serves its own signed and public addresses (`KC_STORAGE_LOCAL_DIR`, `KC_API_PUBLIC_URL`); with no store configured the routes answer `503`. Checked end to end on the KC schema |
| 3 | The app's storage door: upload helper, public URL, signed URL, delete | Done. `apps/mobile/src/services/backend/storageBackend.ts` is the only place that addresses a bucket or builds a storage address; the nine helpers that did are on it. On KC's storage it uses `createApiStorage` (`@kc/infrastructure-api`), whose wire format (`storageWire.ts`) the API shares; the client is checked against the real server on the KC schema. Switched on per build with `EXPO_PUBLIC_KC_API_STORAGE=1`. The door guard's list of file touchpoints went from ten to the door's own Supabase side and one prepared, unused contract |
| 4 | `post.republish` and the six file functions on `ObjectStore` | Done. `post.republish` is served: the hosted adapter runs unchanged, and what it does on `client.storage` (read a photo back from its public address, upload the copy) is answered by KC's store as the member (`platform/storage/storageCallerFiles.ts`), under the same policy and bucket rules as a member's own upload. A method that needs files is declared `member_with_files` and is served only by a server that has a file store, so it can never run without its files. Checked end to end: a republished post has copies of the photo and its thumbnail, stored and indexed as the owner. Two of the six functions are ported as scheduled jobs on `StorageAdmin` (the server's own file work, as the service role): the removal of files no row references, which on KC's storage also finds an upload that was sent and never confirmed, and the purge of an account past its grace period with every file it had. The worker that makes the sanitized copy of each new post photo (`process-post-media`) is ported too: it reads the upload with a size cap, writes the copy and its thumbnail under `derived/` with their index rows, and the database's compare-and-set completion finds them there. All three are checked on the KC schema. The WhatsApp webhook is ported too, with the photo a member sends for a waiting draft stored on KC's storage. `backfill-image-thumbs` is a one-off tool and is not carried over; `strip-exif` is replaced by removing an upload once its copy is ready (below) |
| 5 | The Google Cloud Storage implementation, buckets, CDN (needs the cloud project) | The implementation is done (`platform/storage/gcsObjectStore.ts`, selected by `KC_STORAGE_GCS_BUCKET_PREFIX`), on the official SDK and the service's own identity. One contract suite runs against both stores; the cloud one is checked on the service's emulator in CI. Open, and waiting for the project: the buckets and the CDN, and the run of the suite on a real project, which is the only place the conditions of a signed upload are enforced (below) |
| 6 | The copy-and-verify job for existing files; switch | — |

Steps 1–4 need no cloud account.

## Consequences

- One set of policies, tested in SQL, decides for Supabase Storage today and for KC's store tomorrow.
- The app's paths and the database's references to them do not change. The one stored full address (`avatar_url`) keeps its path and gets the new host in one update at the switch.
- KC owns a `storage` schema it must keep honest: a row without an object, or an object without a row, is what the reconciliation job already looks for.

## The Cloud Storage implementation

- **Buckets.** A KC bucket keeps its name behind a prefix per environment (`kc-dev-avatars`): cloud bucket names are unique among all customers. Object names do not change. A bucket that is missing is an error of the deployment and fails loudly; it is never read as an empty store.
- **A grant is enforced by the store.** A signed upload address carries the grant as signed conditions: the content type, the largest size, and that the name is still free (generation 0). The client must send them back unchanged, and Cloud Storage refuses the upload otherwise, so the rules hold without the bytes passing through the API. The server's own writes use the same "name is free" condition, so two servers cannot both write one name.
- **No key file.** The API runs as its service account and signs addresses through the IAM credentials service. It needs object access on the buckets and the right to sign as itself; both are granted in the Terraform of phase 2.
- **Where it is verified.** The same contract suite runs against the local store and the cloud one. In CI the cloud store runs on the service's emulator, which proves the SDK calls and the shape of the signed addresses but does not page listings, record Cache-Control, or check a signed condition. A second suite for a real project asserts exactly those; it has not run, because there is no project yet, and it is a step of the first deploy.
- **The SDK is the official one, on its previous major line (8.x).** The newest major was two weeks old when this was written and handled credentials differently against the emulator; the upgrade is a dependency bump with the project suite as its check.

## The uploaded originals of post photos

Others are shown the sanitized copy of a photo, never the upload. Decided by the PM (chat, 2026-11-25): **the upload is removed as soon as its copy is ready.** The worker that makes the copy removes the member's upload and its thumbnail right after the database marked the photo ready; a removal that fails is logged and finished by the daily reconciliation, since nothing references the upload any more. This replaces the daily function that rewrote uploads in place (`strip-exif`), which KC's storage cannot do and no longer needs: it is not ported.

One effect to know: a screen that still holds the upload's address (the member's own device, right after publishing) shows the photo again only once it reads the post anew, with the copy's address.

## Limits

- The reconciliation looks for a stored object no row references. A row of the index whose object is gone is not looked for: a delete removes the row first, so it can only be left by a failure of the store between two writes of the same request, and the purge removes such rows for an account it deletes.

- A signed URL stays valid until it expires even if the member loses the right in the meantime; URLs are short-lived for that reason.
- The local-directory store is for development and tests only; it has no CDN and its signed URLs are the API's own routes.
