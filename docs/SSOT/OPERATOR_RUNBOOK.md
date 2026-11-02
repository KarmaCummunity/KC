# Operator Runbook — Karma Community

> Migration verification steps for each numbered migration (0001–0009, P0.6).

**Status**: Migrations 0001–0009 all applied to the live Supabase project (0009 applied 2026-05-08).

## Standard procedure for any migration

```bash
supabase db push
supabase gen types typescript --project-id <ref> \
  | node scripts/strip-partition-types.mjs \
  > app/packages/infrastructure-supabase/src/database.types.ts
```

**GitHub Actions — DB deploy:** migrations reach kc-dev and prod only through the **Deploy** workflow ([`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml), database stage [`deploy-db.yml`](../../.github/workflows/deploy-db.yml); see `ENVIRONMENTS.md` § Deploy pipeline): after a `dev` push passes CI it applies them to kc-dev, and after a `main` push passes CI and the owner approves the release it backs up prod (encrypted) and applies them there without `--include-all`. To re-apply kc-dev migrations by hand, dispatch **Deploy** on `dev` (CI-gated; there is no separate DB dispatch). Each GitHub Environment (`supabase-dev`, `supabase-prod`) defines `SUPABASE_ACCESS_TOKEN` (an **account** token from [Account → Access tokens](https://supabase.com/dashboard/account/tokens), `sbp_…`, not a project key), `SUPABASE_DB_PASSWORD` and `SUPABASE_PROJECT_REF`; `scripts/deploy-preflight.mjs` refuses a ref that does not match the target.

---

## Migration application rules (READ FIRST) {#application-rules}

The repo uses **sequential** migration files (`supabase/migrations/NNNN_snake.sql`, e.g. `0212_glowe_event_registration.sql`). The `schema_migrations` ledger on each Supabase project must match those file versions exactly.

**Rule:** apply schema changes to the dev DB ONLY as committed sequential files, via **`supabase db push`** / **`supabase migration up`** — or let the **Deploy** workflow apply them after a `dev` push passes CI.

**Never** apply a dev schema change with the Supabase MCP **`apply_migration`** tool. It records a **TIMESTAMP** version (e.g. `20260701130827`) that has no local file. `supabase db push` then refuses to run — *"Remote migration versions not found in local migrations directory"* — and the next `DB deploy` on `dev` fails until the ledger is repaired. (The MCP **`execute_sql`** tool is fine for read-only inspection; it does not touch the ledger.)

**Guardrail:** the [`.github/workflows/ci-migration-drift.yml`](../../.github/workflows/ci-migration-drift.yml) workflow (`CI — migration drift`) scans the dev ledger on a 6-hour schedule, on push to `dev`, and on manual dispatch. It fails loudly the moment a remote version has no local file — instead of waiting for the next deploy. It is **not** a required merge check (needs live secrets, never runs on `pull_request`).

**Reconcile drift** (rewrites only the history table — the DDL was already applied, so the schema is untouched):

```bash
source ~/.kc-dev-secrets.env
supabase link --project-ref "$SUPABASE_PROJECT_REF"
node scripts/reconcile-migration-drift.mjs        # prints the exact repair commands
# review, then run each printed command, e.g.:
#   supabase migration repair --status reverted 20260701130827
#   supabase migration repair --status applied  0213
supabase db push --dry-run --include-all --linked --yes   # → "Remote database is up to date."
```

`node scripts/check-migration-drift.mjs` is the same detector the CI guard runs (pipe `supabase migration list --linked` into it).

---

## Restore a pre-migration backup (prod) {#restore-backup}

Before a prod release applies migrations, the database stage of **Deploy** (`deploy-db.yml`, job `backup (prod)`) dumps prod when `supabase/migrations` changed since the last `v*` tag. Each dump streams straight into [`age`](https://age-encryption.org), encrypted to the public key in the `supabase-prod` variable `BACKUP_AGE_RECIPIENT`; plaintext never touches the runner disk or the log. The run keeps artifact `prod-db-backup-<sha>-<attempt>` (`roles.sql.age`, `schema.sql.age`, `data.sql.age`) for **14 days**. **Storage objects (avatars, post images) are not included** — only the database; Supabase Storage keeps them, and a restore does not touch them. It holds user PII: only the owner holds the private key, and decrypted files must never be committed, uploaded or kept after the restore.

Policy (`D-195`): the database is **forward-fix only**. Restore only when a forward-fix migration cannot repair the damage (e.g. data destroyed), and only with the PM's typed confirmation (CLAUDE.md §7).

1. Download the artifact from the Deploy run (Actions → run → Artifacts) to a private machine.
2. Decrypt with the owner's private key: `age -d -i key.txt -o schema.sql schema.sql.age` and the same for `roles.sql.age` and `data.sql.age`.
3. Prefer restoring into a **new** Supabase project (or a branch) and copying the lost rows back; replaying a full dump over live prod also drops everything written since the backup.
4. Restore: `psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 -f roles.sql` (custom roles; skip on a Supabase project where they exist), then `psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 -f schema.sql`, then `psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 -c 'SET session_replication_role = replica' -f data.sql` (triggers off while the data loads).
5. Delete the decrypted files (`shred -u roles.sql schema.sql data.sql`).

The key pair is created once by the owner: `age-keygen -o key.txt` prints the public key (`age1…`) to put in `BACKUP_AGE_RECIPIENT`; `key.txt` stays offline. Without the variable, the prod preflight fails and nothing deploys.

---

## Owner setup for D-195 CI/CD {#owner-setup-ci}

Repository settings only the owner (admin) can apply. Tracked as `INFRA-CI-OWNER` in [`BACKLOG.md`](./BACKLOG.md); background in [`DECISIONS.md`](./DECISIONS.md) `D-195`, layout in [`ENVIRONMENTS.md`](./ENVIRONMENTS.md). Do the steps **in this order**: each merge assumes the settings before it.

1. **Single required check (`dev` done, `main` open).** `dev`: done — the ruleset `dev protection (merge queue)` requires only **`CI gate`** (GitHub Actions), with the merge queue and the repository-admin bypass; #1292 is merged. **`main`: still open** — Settings → Branches → `main` still requires eight legacy contexts that nothing reports any more (`typecheck · test · lint`, `Hebrew source scan (no inline UI copy)`, `web export (production bundle)`, `migration chain lint`, `apply migrations · rls · types · sql probes`, `rpc · table contract`, `PR hygiene`, `SonarCloud quality gate`). Replace them with exactly **`CI gate`**, source **GitHub Actions**, before the next release PR, which otherwise never merges (list in [`ENVIRONMENTS.md` § Dev merge gates](./ENVIRONMENTS.md#dev-merge-gates-branch-protection)).
2. **Bot identities (`INFRA-CI-6`, `INFRA-CI-2`).**
   1. **Agent GitHub App** — Settings (your account or the org) → Developer settings → GitHub Apps → New GitHub App. Name e.g. `kc-agent`; webhook off; **Repository permissions:** Contents **Read and write**, Pull requests **Read and write**, Actions **Read-only**, Checks **Read-only**, Metadata **Read-only** (mandatory); everything else **No access** — never Administration. "Where can this app be installed?" → Only on this account. Create it, note the **App ID**, generate a **private key** (`.pem`).
   2. Install the App → **Only select repositories** → `KC` (no other repository).
   3. Settings → Environments → New environment **`agent-merge`**: Deployment branches and tags → **Selected branches** → add `main` only (if it allows `dev`, replace `dev` with `main`); no reviewers. Not `dev`: `auto-merge-agent-ready.yml` runs on `pull_request_target`, which GitHub runs from the default branch, so the job's ref is `main` and a `dev`-only policy fails it (`TD-240`). Only owner-approved code on `main` can then read the secrets. Add environment secrets `AGENT_APP_ID` = the App ID and `AGENT_APP_PRIVATE_KEY` = the full `.pem` contents. Delete the local `.pem` afterwards, and delete any **repository-level** `AGENT_APP_*` / `AGENT_MERGE_TOKEN` secrets (a repository secret is readable by any workflow pushed on any branch, `TD-223`). `auto-merge-agent-ready.yml` acts as the App, so merges trigger **CI** → **Deploy** (`TD-197`); with no credential it fails visibly.
   4. **Agent machine user** — create a separate GitHub account for Claude / agent sessions (its own e-mail, 2FA on; GitHub's terms allow one machine account per person). Invite it to `KC` with role **Write** — not Maintain, not Admin. Add its login nowhere in `.github/owners.json` or `.github/CODEOWNERS`.
   5. In Claude Code (claude.ai → Settings → Connectors → GitHub, and any local `gh auth login`), disconnect your personal account and connect **the machine user** instead. From then on agent PRs are authored by the machine user, so **you can approve them** (GitHub never counts an author's own approval) and agents can no longer use your admin rights to bypass rules.
   6. Optional fallback: a fine-grained PAT of the machine user (this repository only; Contents + Pull requests read/write) as `agent-merge` environment secret `AGENT_MERGE_TOKEN`.
   7. **CI-verdict GitHub App** (a second, separate App — the ruleset will accept `CI verdict` only from it). New GitHub App, e.g. `kc-ci-verdict`; webhook off; **Repository permissions:** Checks **Read and write**, Actions **Read-only**, Contents **Read-only**, Pull requests **Read-only**, Metadata **Read-only**; nothing else. Only on this account; install on `KC` only. Note its **App ID** (this is the `integration_id` for the ruleset) and generate a private key.
   8. Settings → Environments → New environment **`ci-verdict`**: Deployment branches → **Selected branches** → `main` only (the default branch, where `workflow_run` jobs run); no reviewers. Environment secrets `CI_VERDICT_APP_ID` and `CI_VERDICT_APP_PRIVATE_KEY`. Never store them at repository level.
   9. Move the remaining sensitive repository-level secrets into branch-restricted environments when their workflows allow it (store credentials into `mobile-store`, see `TD-223` for the list).
3. **Prod environments** (gated prod release, `INFRA-CI-3`; #1308 is merged, so `main` deploys need these before the first release). Settings → Environments:
   - `production` — required reviewer: **you** only; deployment branches: `main` only; no secrets.
   - `supabase-prod`, `cloudflare-prod` — deployment branches `main` only; no reviewers. `supabase-dev`, `cloudflare-dev` — deployment branches `dev` and `main`; no reviewers.
   - Variables: `BACKUP_AGE_RECIPIENT` on `supabase-prod` (see [§ Restore a pre-migration backup](#restore-backup) for the key pair); repository variables `KC_PROD_URL` and `DEV_WEB_URL` ([`ENVIRONMENTS.md`](./ENVIRONMENTS.md) table). Delete the legacy `PROD_WEB_URL`.
   - `EXPO_PUBLIC_ENVIRONMENT` per environment: `production` on `cloudflare-prod`, `development` on `cloudflare-dev`.
   - The Cloudflare API token in `cloudflare-*` needs **Cloudflare Pages: Edit**.
4. **Mobile store** (nightly mobile, `INFRA-CI-4`; PR #1304 is already merged, so the nightly fails until this is done).
   - Environment `mobile-store` (deployment branches `dev` + `main`) with secret `MOBILE_SUPABASE_ANON_KEY` = the **kc-dev** publishable key.
   - EAS → project → Environment variables → `preview`: the Sentry values and the `GOOGLE_SERVICES_JSON` file variable.
   - Verify the iOS signing secrets are present (`KC_IOS_*`, `ASC_*`).
   - Allow `mobile/*` tags (if a tag ruleset restricts tag creation, add `mobile/*` to the allowed patterns).
   - Then dispatch **Mobile nightly** once on `dev` to confirm.
5. **Import the ruleset (`INFRA-CI-2`).** The gate-integrity PR #1319 is merged.
   - **First release to `main` (one-time).** The release PR into `main` loads its judges from `main`, which has none yet, so its `CI gate` fails at `detect changes` and no lane runs. `main`'s classic protection includes administrators, so not even an admin can merge it. Before you merge, check that the latest `dev` push run of **CI** is green: it runs every lane except the release lane. Then: Settings → Branches → `main` → edit → untick **Do not allow bypassing the above settings** → merge the release PR → tick it again. The push to `main` then runs the full CI with `main`'s new judges, and **Deploy** waits for your approval click. Every later release is judged normally.
   - **One-time bootstrap.** The judges now load only from the base commit, with no fallback to the PR's copy. The PR that introduces a judge module (the test-integrity guard, the run binding) therefore fails its own `static` lane / `CI gate`, because its base does not have them yet. Read the diff, then merge it once with your admin override (the live `dev` ruleset allows the repository-admin bypass; the committed `dev-main.json` has no bypass actors). Every later PR is judged by the merged copy. Done for #1319; repeat only for a future judge-first PR that cannot pass its own gate.
   - **Version-bump App (`TD-231`) — before you delete `AGENT_MERGE_TOKEN` or import the ruleset.** `bump-version-on-merge.yml` pushes the ID commit and a `[skip ci]` `app/VERSION` commit straight to `dev` after every merge, as a third GitHub App whose only power is that push:
     1. New GitHub App **`kc-version-bump`**; webhook off; **Repository permissions:** Contents **Read and write**, Metadata **Read-only**; nothing else (no Pull requests, so it cannot merge or approve). Only on this account; install on `KC` only. Note its **App ID** and generate a private key.
     2. Settings → Environments → New environment **`version-bump`**: Deployment branches → **Selected branches** → `dev` only (the job runs on `push` to `dev`); no reviewers. Environment secrets `VERSION_BUMP_APP_ID` and `VERSION_BUMP_APP_PRIVATE_KEY`. Delete the local `.pem`.
     3. Settings → Rules → Rulesets → `dev protection (merge queue)` → Bypass list → **Add bypass** → the `kc-version-bump` App, mode **Always**. Add it only to a ruleset that targets `dev` alone: a bypass covers every branch its ruleset targets, so never add it to one that also targets `main` (when you import `dev-main.json`, keep the bypass on a `dev`-only ruleset).
     4. Check: after the next merge into `dev`, **Bump app version on merge** is green and `dev` has a `chore(release): bump app version to …` commit. Only then delete `AGENT_MERGE_TOKEN` (also once an App-driven auto-merge has worked, step 2.3).
     Residual risk: anyone who gets a workflow using `version-bump` onto `dev` can push to `dev` without the merge queue. Adding such a workflow is a code-owned `.github/**` change, and only bump-shaped commits inherit a deploy certification (`scripts/deploy-target.mjs`); any other pushed commit still needs its own green push CI run.
   - **Import.** Settings → Rules → Rulesets → New ruleset → **Import a ruleset** → upload [`.github/rulesets/dev-main.json`](../../.github/rulesets/dev-main.json). For now **delete the `CI verdict` entry** from the required checks in the import form (or the file copy you upload): `ci-verdict.yml` runs only from the default branch `main`, so no verdict exists until the release carrying it reaches `main`, and every PR would wait forever. Review → Create. The ruleset targets `dev` + `main`: pull request with **0** approvals + **Require review from Code Owners** + dismiss stale approvals + approval of the most recent push; required check `CI gate` from GitHub Actions (`integration_id` 15368); no force pushes, no deletions; **no bypass actors**. Then remove the classic branch-protection rule on `main`. `dev` already has the live ruleset `dev protection (merge queue)` (admin bypass, merge queue): either add the stricter rules to it and keep its merge queue, or delete it once the imported ruleset carries a merge queue for `dev`. Do not leave two rulesets with different required checks on `dev`. Import [`.github/rulesets/tags-no-branch-names.json`](../../.github/rulesets/tags-no-branch-names.json) the same way (target: tags; forbids creating, moving or deleting tags named `dev` or `main`, so no tag can pose as a protected branch). Under the ruleset PRs need not be up to date with `dev` (not strict); the `dev` merge queue tests each PR on top of the ones ahead of it. When a CI run fails on a flake, use **Re-run all jobs**: a "Re-run failed jobs" attempt keeps old job results and never gets a green `CI verdict`.
   - **Verify right after import** with two throwaway PRs into `dev`: (a) a docs-only change must merge on a green `CI gate` with no review; (b) a one-line comment change in `.github/CODEOWNERS` must ask for your review. GitHub does not document how "approval of the most recent push" behaves with 0 required approvals; if PR (a) also waits for an approval, edit the ruleset and turn that one option off (code-owner review + stale-approval dismissal still cover owned files).
   - **Turn on `CI verdict` after the first release that carries `ci-verdict.yml` reaches `main`.** Open a throwaway PR into `dev` and check that a green **`CI verdict`** check from the CI-verdict App appears on its head commit (the App's name is shown as the check's source). If it is red, its summary says why (e.g. the run's merge reference could not be read) — fix before continuing. Then Settings → Rules → Rulesets → `dev-main gate (D-195)` → Require status checks → add `CI verdict` and pick the **CI-verdict App** as its source (equivalently, re-import the JSON with `"integration_id"` set to the App ID instead of `REPLACE_WITH_CI_VERDICT_APP_ID`). Until this step, `CI gate` alone can be imitated by a workflow on another branch (`TD-224`).
   - Owner overrides: when `CI gate` fails with a "Test integrity" or "ci.yml must keep the base branch's lanes and jobs" error, read the listed reasons; if the change is intended, **approve the PR** — the review re-runs CI and the gate (and then `CI verdict`) turns green for that head SHA. A new push needs a new approval. Overrides do not work through a merge queue.
6. **Bot noise.** Every bot comment or status edit wakes the Claude session that owns the PR; the sessions follow `.claude/skills/babysit/SKILL.md` and `.coderabbit.yaml` posts no status comments or commit statuses. SonarCloud → project `KarmaCummunity_MVP-2` → Administration → Pull Request decoration (or the organization's GitHub binding settings): disable the summary comment, keep the check.
7. **Cleanup.** Delete the `tmp-probe-*` workflows (and any runs you no longer need) and the stale branch `chore/ci-nightly-mobile` (superseded by `chore/ci-nightly-mobile-2`).

---

## Adding a CI lane needs a judge-first PR {#ci-lane-judge-first}

On pull requests, `ci.yml` runs the gate judges (`scripts/ci-changes.mjs`, `scripts/ci-gate.mjs`) from the **base** branch, so a PR cannot weaken its own gate (`D-195`). The flip side: a PR that adds a lane job to `ci.yml` together with the judge changes fails `CI gate` with `job "<lane>" is not in the change detector's plan`, because the base judges do not know the lane yet. Ship it in two PRs:

1. **Judge-first PR** — teach `ci-changes.mjs` / `ci-gate.mjs` (and `check-required-checks-drift.mjs` if needed) about the lane **without** adding the job to `ci.yml`, in a form the current judges and the current `ci.yml` still pass (e.g. an optional lane that is named in the plan only when needed, like `release`).
2. **Lane PR** — after the first merges, add the job to `ci.yml`.

**Second instance — the test-integrity judge (INFRA-CI-2, PR #1308).** #1308's static lane runs `.judge/scripts/check-test-integrity.mjs` from the base commit with no fallback, so it could not pass while `dev` lacked the script. The judge-first PR (`chore/ci-integrity-judges`) ships only the base-loaded files — `scripts/check-test-integrity.mjs`, its sole import `scripts/ci-github.mjs`, their tests, and `.github/owners.json` (read at the base commit) — without wiring them into `dev`'s workflows. `scripts/ci-gate.mjs` deliberately stays at `dev`'s version: `dev`'s `ci.yml` copies that one file alone to `$RUNNER_TEMP`, so #1308's multi-module gate (it imports `ci-changes`, `ci-github`, `ci-run-binding`, `ci-run-reuse`, `ci-workflow-diff`) would fail to load there; `dev`'s standalone gate already judges #1308's `pull_request` runs. Until #1308 merges, a review on it re-runs every lane (the base `ci-changes.mjs` does not plan review events from the diff) instead of reusing lane results — slower, still sound.

**Third instance: the heavy `bundles` lane (`D-195` addendum "PR = fast feedback, merge queue = full gate").** The judge-first PR (`ci/fast-pr-full-queue-judges`) teaches `ci-changes.mjs` to plan merge groups like pushes (every lane) and to name `bundles` (`false` on PRs into `dev`, otherwise as needed as `frontend`) only once the running `ci.yml` defines a top-level `bundles:` job, and teaches `ci-gate.mjs` to accept a deferred heavy lane only on PRs into `dev`. With `dev`'s `ci.yml` unchanged the plan has no `bundles` key, so every PR and push keeps passing. The wiring PR (`ci/fast-pr-full-queue`) then adds the job, moves the web and native builds out of `ci-frontend.yml`, and makes `bundles` a regular lane in the scripts (taking effect once it is the base). It changes `ci.yml`, so it needs an owner approval on its head SHA, and like every `ci.yml` change it cannot pass the merge queue: the owner merges it with the admin bypass after its PR gate is green.

---

## 0001 — Foundation & Identity {#0001}

Verify: sign in with Google → confirm row appears in `public.users` with Google name + avatar → re-sign-in must not create a duplicate row.

---

## 0002 — Posts core {#0002}

Verify: sign in as test user → insert via SQL editor:
```sql
insert into posts (owner_id, type, title, city, street, street_number)
values ('<your-user-id>', 'Give', 'Test couch', '5000', 'Bialik', '12');
```
Expect the row to appear. Once P0.4 wires real CRUD, it should surface in the feed.

---

## 0003 — Following & Blocking {#0003}

```sql
-- NULL-safe helper
select public.is_blocked(
  '00000000-0000-0000-0000-000000000000'::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid
); -- → false

-- Self-follow must error self_follow_forbidden
insert into public.follow_edges(follower_id, followed_id) values ('A', 'A');

-- Blocked relationship must error blocked_relationship
insert into public.blocks(blocker_id, blocked_id) values ('A', 'B');
insert into public.follow_edges(follower_id, followed_id) values ('A', 'B');
```

Regenerate `database.types.ts` after applying.

---

## 0004 — Chat & Messaging {#0004}

```sql
-- NULL-safe helper
select public.has_blocked(null::uuid, null::uuid); -- → false

-- Canonicalize trigger: (B, A) must return (A, B)
insert into public.chats (participant_a, participant_b)
values ('B-uuid', 'A-uuid')
returning participant_a, participant_b;

-- Message must bump chats.last_message_at
insert into public.messages (chat_id, sender_id, body)
values ('<chat-id>', 'A-uuid', 'hello');

-- After A blocks B: querying chats as A → 0 rows (RLS hides); as B → row still visible
```

Realtime: subscribe a client to `messages:chat_id=eq.<chat-id>` and send a message — recipient must receive the event.

Regenerate `database.types.ts` after applying.

---

## 0005 — Moderation {#0005}

```sql
-- Admin helper
select public.is_admin(null::uuid); -- → false

-- Report must create a reporter_hide row + audit_events row
insert into public.reports (reporter_id, target_type, target_id, reason)
values ('A-uuid', 'post', '<post-id>', 'Spam');

-- Re-running same INSERT within 24 h must error duplicate_report

-- After 3 distinct reporters on the same post:
-- posts.status must flip to removed_admin
-- audit_events must have an auto_remove_target row

-- Bump posts.reopen_count to 5 → moderation_queue_entries row with reason='excessive_reopens'
```

Regenerate `database.types.ts` after applying.

---

## 0006 — Stats Counters {#0006}

```sql
select * from public.community_stats;
-- → 1 row with registered_users, active_public_posts, items_delivered_total, as_of

-- As user A, insert a Public post, then:
select active_posts_count_internal,
       active_posts_count_public_open,
       posts_created_total
from public.users where user_id = 'A-uuid';
-- → 1, 1, 1

-- visibility is upgrade-only: OnlyMe → Public allowed; Public → OnlyMe is blocked by trigger
-- After deleting the post: active_posts_count_internal + public_open → 0; posts_created_total stays 1

-- Viewer-aware function
select public.active_posts_count_for_viewer('A-uuid', 'A-uuid'); -- owner view (internal)
select public.active_posts_count_for_viewer('A-uuid', null);      -- anon view (public-only)

-- Two users mutual follow → followers_count + following_count of both = 1

-- Clamp-at-zero NOTICE
select public.stats_safe_dec(0); -- → 0, emits NOTICE in pg logs
```

Regenerate `database.types.ts` after applying.

---

## 0007 — Users Realtime Publication {#0007}

```sql
-- users must be in the publication
select tablename
from pg_publication_tables
where pubname = 'supabase_realtime' and schemaname = 'public';
-- row with tablename = 'users' must be present

-- Subscribe a client to the users channel, then:
update public.users
set followers_count = followers_count
where user_id = '<id>';
-- subscribed client must receive the Realtime event
```

---

## 0008 — City Seed {#0008}

```sql
select count(*) from public.cities; -- ≥ 1,306

-- New auth user created via trigger must have city = '5000', city_name = 'תל אביב - יפו'
-- Pre-existing users with legacy slug cities must be remapped to numeric codes
```

Regenerate `database.types.ts` after applying.

---

## 0009 — Avatars Storage bucket {#0009}

Required for FR-AUTH-011 (onboarding profile photo) and FR-PROFILE-007 (Edit Profile photo replace).

```sql
-- Bucket must exist with the right shape
select id, public, file_size_limit, allowed_mime_types
from storage.buckets where id = 'avatars';
-- → ('avatars', true, 524288, '{image/jpeg}')

-- 4 RLS policies must exist on storage.objects
select polname from pg_policies
where schemaname = 'storage' and tablename = 'objects' and polname like 'avatars_%';
-- → avatars_insert_own, avatars_update_own, avatars_delete_own, avatars_read_public

-- As authenticated user A, upload to <user_a_id>/avatar.jpg → success
-- As authenticated user A, upload to <user_b_id>/avatar.jpg → RLS denied
-- As anon, fetch public URL of any avatars/<id>/avatar.jpg → 200 OK
```

After apply, verify in the app: onboarding photo step → camera or gallery → image visible after upload → "Continue with current photo" advances to tour. Errors keep Skip available.

---

## P0.6 — Closure flow (one-time setup, 2026-05-10)

The closure flow ships two SQL migrations that depend on the `pg_cron` extension being enabled on the Supabase project. The migration file is idempotent and safe to re-run.

### 1. Enable `pg_cron` extension

In the Supabase dashboard:

1. Database → Extensions → search "pg_cron".
2. Toggle **Enable**.

### 2. Apply migrations

```bash
# From the repo root, with the Supabase CLI logged in to the dev project:
supabase migration up 0015_closure_rpcs.sql
supabase migration up 0016_closure_cleanup_cron.sql

# Or via the dashboard SQL editor: paste each file's contents and run.
```

### 3. Verify

```sql
-- Two new RPCs exist
select proname from pg_proc
 where proname in ('close_post_with_recipient', 'reopen_post_marked', 'closure_cleanup_expired_with_metric');
-- → 3 rows

-- Daily cron schedule installed
select jobname, schedule from cron.job where jobname = 'closure_cleanup_daily';
-- → ('closure_cleanup_daily', '0 4 * * *')

-- Metric table exists
select count(*) from public.closure_cleanup_metrics; -- 0 until first run
```

### 4. App-side smoke (after migrations)

- Sign in as a test user with at least one open post and one chat partner on it.
- PostDetail → "סמן כנמסר ✓" → Step 1 confirm → Step 2 picker → "סמן וסגור ✓" → Step 3 explainer → done.
- Profile → "פריטים שתרמתי" should be +1.
- Reopen the same post via "📤 פתח מחדש" → counter -1.

Repeat for staging / prod when promoting.

---

## FR-STATS — Activity log + nightly counter recompute (migrations `0044`, `0045`, 2026-05-12)

Same **`pg_cron` prerequisite** as P0.6 §1. Apply `0044_personal_activity_log.sql` then `0045_stats_recompute_nightly.sql` (or `supabase db push` from repo root).

### Verify

```sql
-- Timeline RPC still exists (reads `user_personal_activity_log`)
select proname from pg_proc where proname = 'rpc_my_activity_timeline';

-- Nightly job + drift tables
select proname from pg_proc where proname = 'stats_recompute_personal_counters_nightly';
select jobname, schedule from cron.job where jobname = 'stats_recompute_nightly';
-- → ('stats_recompute_nightly', '15 4 * * *') when pg_cron is enabled

-- Manual smoke (postgres / SQL editor — function is not granted to `authenticated`)
select * from public.stats_recompute_personal_counters_nightly();
select * from public.stats_recompute_runs order by run_id desc limit 3;
```

Drift rows are visible to super-admins via RLS on `stats_drift_events` / `stats_recompute_runs`. For **NFR-RELI-005** (>0.1% drift/night), wire alerts from database logs or export `stats_drift_events` to your metrics stack.

Regenerate `database.types.ts` after applying (or merge the manually added table + function stubs from `main`).

---

## Edge Functions — CI deploy + prod smoke (2026-05-12)

**Workflow:** the Edge Functions stage of **Deploy** (`.github/workflows/deploy-functions.yml`), after the database stage, for every `dev` push that passes CI (kc-dev) and every approved `main` release (prod). It deploys every function in `supabase/functions` except `_shared` and the local-only `mock-login`; the deploy smoke then sends `OPTIONS` to each and fails on a 5xx or 404. No push or manual trigger of its own — dispatch **Deploy** on `dev` to redeploy kc-dev.

**GitHub:** Repository → Settings → Environments → `supabase-prod` / `supabase-dev` must expose the same secrets as DB deploy:

| Secret | Purpose |
| ------ | ------- |
| `SUPABASE_ACCESS_TOKEN` | Supabase account access token (dashboard → Account → access tokens). |
| `SUPABASE_PROJECT_REF` | Project ref from the dashboard URL (not `project_id` from local `config.toml`). |

| Variable (optional, recommended) | Purpose |
| -------------------------------- | ------- |
| `PUBLIC_RESEARCH_ALLOWED_ORIGINS` | Comma-separated `Origin` allowlist for `public-research-submit`. Synced on each deploy when set. |

| Secret (optional, recommended) | Purpose |
| ------------------------------ | ------- |
| `EDGE_SENTRY_DSN` | DSN of the Sentry project for Edge Functions (G41, `D-202`). Synced on each deploy to the Supabase secrets `SENTRY_DSN`, `SENTRY_ENVIRONMENT` (`prod` on `supabase-prod`, `dev` on `supabase-dev`) and `SENTRY_RELEASE` (`functions@<sha>` of the deployed commit). Without it every function stays in log-only mode. |

**Survey B CORS values (2026-05-29 catch-up):**

| Environment | `PUBLIC_RESEARCH_ALLOWED_ORIGINS` |
| ------------- | --------------------------------- |
| `supabase-dev` | optional — leave unset unless an extra origin is needed |
| `supabase-prod` | optional — leave unset unless an extra origin is needed |

`supabase/functions/_shared/cors.ts` always allows the Cloudflare Pages hosts (`https://dev.karma-community.pages.dev`, `https://karma-community-kc.com`, `https://www.karma-community-kc.com`) and the local dev origins. The 2026-05-29 values pointed at the retired Railway hosts; drop those origins if they are still set.

CLI one-liner (from repo root, account token in env):

```bash
supabase secrets set PUBLIC_RESEARCH_ALLOWED_ORIGINS="<origins>" --project-ref <ref>
```

`SUPABASE_DB_PASSWORD` is **not** required for function deploy.

### Edge Function error reporting (G41, `D-202`)

Every function is wrapped by `withObservability` (`supabase/functions/_shared/observability/`): a throw that escapes the handler and every 5xx response reach Sentry; handled fatal paths and the WhatsApp agent background job call `reportError`. Secrets are referenced by name only.

**One-time setup per environment:**

1. Sentry project: **`kc-z0` / `citov`** (us.sentry.io), client key **"Edge Functions"** (Settings → Client Keys). One key serves both environments; events carry `environment: prod | dev`. A dedicated key keeps rate limits and deactivation separate from any other sender.
2. GitHub → Settings → Environments → `supabase-prod` and `supabase-dev` → add the secret `EDGE_SENTRY_DSN`.
3. The next **Deploy** run (every `dev` push that passes CI; every approved `main` release) syncs it in the Edge Functions stage (`deploy-functions.yml`), before the functions are deployed. The step is skipped while the secret is absent.

CLI equivalent (account token in env):

```bash
supabase secrets set SENTRY_DSN="<dsn>" SENTRY_ENVIRONMENT=dev --project-ref <ref>
```

**Verify:** Supabase → Edge Functions → Logs: each failure writes one `{"evt":"edge_error","fn":…,"sentry":"sent","event_id":…}` line; the same `event_id` opens in Sentry (filter `edge_function:<name>`; `function` is a reserved Sentry tag key, so the function name is tagged `edge_function`). `"sentry":"skipped_no_dsn"` means the secret is not set on that project; `"failed"` means Sentry rejected or timed out the envelope (the function response is unaffected either way).

**What is never sent:** request bodies, headers, query strings, and free-text error messages from responses — only identifier-shaped `error` codes become tags.

**After merge:** open Actions → the **Deploy** run for the commit → confirm the `edge functions` and `smoke` stages succeeded. If a stage failed: fix secrets/permissions, then use **Re-run all jobs** — never **Re-run failed jobs**. Every stage that changes an environment starts with the deploy guard, which refuses an attempt whose release approval or rollback baseline came from an earlier attempt, so a partial re-run fails on prod; **Re-run all jobs** re-resolves the commit (it must still be the `main` tip) and asks the owner to approve again. On prod a failed release has already been rolled back to the previous tag (unless it applied migrations — then it demands a forward-fix).

**One-time catch-up (if prod was behind `main`):** from a machine with the CLI logged in, at repo root:

```bash
supabase link --project-ref "<SUPABASE_PROJECT_REF>"
supabase functions deploy
```

**Smoke — donation link edit (guards against stale `validate-donation-link`):**

1. As an authenticated user, open an existing donation link and change only display name; save.
2. In SQL editor: `select id, display_name, validated_at, created_at from public.donation_links where submitted_by = '<user_id>' order by created_at desc limit 5;`  
   Expect **one** row per logical link: the same `id` as before the edit, updated `display_name` / `validated_at` — not a second row with the same URL/category from the same edit session.

### Optional — duplicate `donation_links` rows from pre-fix prod

If historical bad data exists (same contributor intent, two live rows), identification is **manual** and needs product/operator judgment — do **not** bulk-delete blindly.

Heuristic: same `submitted_by`, same `category_slug`, same `url`, two rows with different `created_at` (often the “edit” created an unintended INSERT). Keep the row you want to show (typically the older canonical row or the one referenced by UI); remove or soft-hide the duplicate per your data policy. Migration `0050_donation_links_purge_soft_deleted.sql` only addresses `hidden_at` / soft-delete hygiene, not this class of duplicate.

---

## Backfill image thumbnails (PERF-4, 2026-05-28)

After PR-1a (`perf(images): upload-time thumbs ...`) ships, **new** post / avatar uploads always write a sibling `-thumb.jpg` object. **Existing** objects need a one-time backfill pass to get the same wins.

The `backfill-image-thumbs` Edge Function scans `post-images` and `avatars` buckets, downloads each non-thumb object, resizes via ImageMagick WASM (400px for posts, 96px for avatars), and uploads the thumb with `cache-control: public, max-age=31536000, immutable`. Idempotent: existing thumbs are skipped, so it's safe to re-run.

### Run against dev

From a machine with the Supabase CLI logged in (or a service-role JWT in `$SR`):

```bash
SUPABASE_REF=enbqriuxvvuontiwslun
SR="$(cat ~/.kc-dev-secrets.env | grep SUPABASE_SERVICE_ROLE_KEY | cut -d= -f2-)"

# Dry-run first to see what would be processed:
curl -sS -X POST "https://${SUPABASE_REF}.supabase.co/functions/v1/backfill-image-thumbs" \
  -H "Authorization: Bearer ${SR}" \
  -H "Content-Type: application/json" \
  -d '{"dryRun":true,"pageLimit":500}'

# Real run — invoke repeatedly until `results[*].more === false`:
curl -sS -X POST "https://${SUPABASE_REF}.supabase.co/functions/v1/backfill-image-thumbs" \
  -H "Authorization: Bearer ${SR}" \
  -H "Content-Type: application/json" \
  -d '{"pageLimit":100}'
```

Per-invocation budget is bounded by Edge Function timeout (25s on free tier). `pageLimit: 100` is a safe default that fits inside that envelope. Bump or lower based on dashboard latency.

### Body options

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `bucket` | `"post-images" \| "avatars" \| "both"` | `"both"` | Narrow the scope. |
| `pageLimit` | `number` (1-500) | `100` | Max objects processed per invocation. |
| `lookbackHours` | `number` | _all_ | Only objects newer than `now - hours`. |
| `dryRun` | `boolean` | `false` | Count + log without writing. |

### Response

```json
{
  "ok": true,
  "dryRun": false,
  "results": [
    { "bucket": "post-images", "scanned": 100, "generated": 87, "skipped_existing": 13, "errors": 0, "more": true },
    { "bucket": "avatars",     "scanned":  42, "generated": 39, "skipped_existing":  3, "errors": 0, "more": false }
  ]
}
```

Re-invoke until every entry's `more` is `false`.

### Run against prod

Same flow, swap `SUPABASE_REF` and use the prod service-role bearer. The function ships to prod with every approved release (Edge Functions stage of **Deploy**).

---

## KC support channels — donations to KC (FR-DONATE-011, migration `0447`)

The Money hub's *Support KC directly* card reads its payment links from `public.kc_support_channels`. Changing a row changes the app immediately — **no release**. Only super admins can write (RLS); the URL must be `https://` with no credentials (CHECK).

| `channel` | Shown as | Seeded |
|---|---|---|
| `bit` | One-time — Bit (interim, D64) | ✅ (FR-DONATE-010 link) |
| `paybox` | One-time — PayBox (interim, D64) | ✅ (FR-DONATE-010 link) |
| `card_one_time` | One-time — credit-card hosted page | ❌ add after Grow setup |
| `card_standing_order` | Monthly standing order — hosted page | ❌ add after Grow setup |

### Add / replace a provider page (e.g. Grow, launch plan A11)

Create two hosted pages in the Grow dashboard (one-time; recurring monthly), then run against **dev first**, check the app, then prod:

```sql
insert into public.kc_support_channels (channel, url, provider_label)
values
  ('card_one_time',       'https://<grow one-time page>', 'Grow'),
  ('card_standing_order', 'https://<grow recurring page>', 'Grow')
on conflict (channel) do update
  set url = excluded.url, provider_label = excluded.provider_label, is_active = true;
```

As soon as an active `card_one_time` row exists, the app hides Bit / PayBox on its own (D64) — on the Money hub and on the About / Settings card. Once clearing is confirmed working on prod, remove the interim rows for good: `delete from public.kc_support_channels where channel in ('bit', 'paybox');`

The app has **no compiled payment links**: if this table cannot be read, donors see "unavailable" rather than a stale link.

Pause a channel: `update public.kc_support_channels set is_active = false where channel = '<channel>';`

### Standing-order cancellation requests (legal obligation)

A donor's *Request to cancel a standing order* posts `בקשה לביטול הוראת הקבע שלי לתמיכה בקהילת קארמה.` (en: *Request to cancel my standing order…*) to their support thread with the super admin. The app promises cancellation **within 3 business days** (Israeli Consumer Protection Law §13D): cancel the recurring transaction in the provider dashboard, then confirm in the same chat.

### Sandbox org-payments flow

The in-app verified-nonprofit donation flow (#850) is sandbox-only and hidden by default. To exercise it on dev: `update public.app_flags set enabled = true where key = 'money_in_app_org_payments';` — never on prod until a real provider is wired.

## Ops health alerts {#ops-health-alerts}

The hourly **Ops health monitor** (`.github/workflows/ops-health.yml`, G42) reads `ops.run_health_checks()` (migration `0463`) on dev and prod and keeps one GitHub issue per failing check, labelled `ops-alert` + `ops:<env>` + `ops:<severity>` and assigned to the PM (GitHub emails the assignee). The issue updates when the value changes and **closes itself** once the check is ok again. Issues are public: they carry counts and job names only, never user data.

**Tune, don't patch:** thresholds, severity and on/off live in `ops.health_checks` rows. Change them with a migration (e.g. `update ops.health_checks set threshold = 5 where check_key = '…'`). To try the monitor without opening issues: run the workflow manually with **dry_run**.

| Check | Means | First step |
| --- | --- | --- |
| `health_report_unavailable` | The monitor could not read the report (token, project ref, network, or migration `0463` missing). | Open the failed workflow run; check the environment's `SUPABASE_ACCESS_TOKEN` / `SUPABASE_PROJECT_REF` and that `0463` is applied. |
| `scheduled_jobs_failed` | A `pg_cron` job failed in the last 24 h (job names in the detail). | `select * from cron.job_run_details where status = 'failed' order by start_time desc limit 20;` and fix the job's function. |
| `notifications_backlog` | Notifications waited > 15 min undispatched: the dispatcher is down. | Check `dispatch-notification` logs and the trigger that calls it. |
| `notifications_push_failures` | More than 10 push sends failed in 24 h (skips like `no_devices` excluded). | Group `notifications_outbox.last_error` for the last day; Expo push credentials are the usual cause. |
| `matching_errors` | Automatic matching failed for some listings (`match_listing_state.last_error`). | Read the `last_error` values; see `docs/SSOT/MATCHING_V2.md`. |
| `rides_bookings_unconfirmed` | Seat bookings passed their confirm-by deadline without a driver decision. | Expected until booking expiry ships (S45, G47); otherwise check the confirm flow. |
| `rides_open_after_departure` | Ride offers still open 6 h after departure. | Expected until per-type expiry ships (D21, G32); otherwise check the expiry job. |
| `rides_trips_not_completed` | Confirmed seats not completed a day after departure. | Check the completion flow (`complete_ride_trip`); users may need a reminder. |

**Adding a check** (any giving world): a migration with a `stable` function `ops.check_<key>()` returning `ops.health_result` (count + data-free detail) and a row in `ops.health_checks`; extend `supabase/tests/0463_ops_health_registry.sql` or the world's own test.

## Publishing legal documents (FR-SETTINGS-010)

Editable from Supabase Studio without a frontend deploy. Each publish is an immutable `legal_document_versions` row plus an update to the current-pointer row in `legal_documents`. The trigger computes `content_hash` (SHA-256) automatically.

**Severity semantics:**
- `minor` — typo / cosmetic. No re-acknowledgement. `change_summary` may be null.
- `standard` — material change. Users see a 7-day soft-grace banner, then the server promotes the gate to a blocking modal at day 7. `change_summary` is required (Markdown bullets shown on the consent card).
- `critical` — urgent change. Blocks immediately on the next foreground. `effective_date` must be within 1 hour of `now()`; the RPC rejects scheduled criticals.

### Snippet 1 — Publish Terms (minor): typo / cosmetic, no re-ack

```sql
select public.publish_legal_document(
  p_doc_type       => 'terms',
  p_body_md        => $$
# תנאי שימוש
<full Markdown body here>
$$,
  p_severity       => 'minor',
  p_change_summary => null,
  p_effective_date => now()
);
```

### Snippet 2 — Publish Terms (material): re-ack required, 7-day soft grace

```sql
select public.publish_legal_document(
  p_doc_type       => 'terms',
  p_body_md        => $$
# תנאי שימוש
<full Markdown body here>
$$,
  p_severity       => 'standard',
  p_change_summary => $$- בולט 1
- בולט 2
- בולט 3$$,
  p_effective_date => now()
);
```

### Snippet 3 — Publish Privacy (minor)

Same as Snippet 1 with `p_doc_type => 'privacy'`.

### Snippet 4 — Publish Privacy (material)

Same as Snippet 2 with `p_doc_type => 'privacy'`.

### Snippet 5 — Publish CRITICAL (blocks all users immediately)

Use sparingly. Effective date must be within 1 hour of `now()` or the RPC rejects.

```sql
select public.publish_legal_document(
  p_doc_type       => 'privacy',
  p_body_md        => $$<full Markdown>$$,
  p_severity       => 'critical',
  p_change_summary => $$- שינוי דחוף שדורש אישור מיידי$$,
  p_effective_date => now()
);
```

### Verification after publish

```sql
select doc_type, current_version, last_material_version, last_material_severity
  from public.legal_documents;
```

The published row should show the new `current_version`. For `standard` / `critical`, `last_material_version` advances; for `minor`, it stays.

---

## External GLOWE contributors (INFRA-OSS-8)

Org project board: [GloWe (#2)](https://github.com/orgs/KarmaCummunity/projects/2) — public.

### Labels

| Label | Use |
| --- | --- |
| `contributor-facing` | Safe for volunteers |
| `good first issue` / `help wanted` | Entry / next tasks |
| `maintainer-only` | Org-admin / PM only (Snyk, CodeRabbit, GitGuardian, Phase C, …) |
| `area:glowe-web` / `area:docs` / `area:a11y` / `area:i18n` | Area filter |
| `size:S` / `size:M` | Effort hint |

### Project views (maintainer setup)

**Project:** [GloWe #2](https://github.com/orgs/KarmaCummunity/projects/2)

| View | Layout | Filter | URL |
|------|--------|--------|-----|
| **Contributor board** (default for newcomers) | Board | `label:contributor-facing is:open` | [view/4](https://github.com/orgs/KarmaCummunity/projects/2/views/4) |
| **Good first issues** | Table | `label:"good first issue" is:open` | [view/5](https://github.com/orgs/KarmaCummunity/projects/2/views/5) |
| **Maintainer / blocked** | Table | `label:maintainer-only is:open` | [view/6](https://github.com/orgs/KarmaCummunity/projects/2/views/6) |

Legacy unfiltered views (`View 1`, `board`, `RoadMap`) can be removed in the project UI
(**⋯ → Manage views → Delete**). The REST API does not expose view delete/patch for org
projects (404 as of 2026-07).

#### Create or recreate views via REST (requires `project` scope)

```bash
gh auth refresh -h github.com -s project,read:project

gh api -X POST orgs/KarmaCummunity/projectsV2/2/views \
  -f name='Contributor board' -f layout='board' \
  -f filter='label:contributor-facing is:open'

gh api -X POST orgs/KarmaCummunity/projectsV2/2/views \
  -f name='Good first issues' -f layout='table' \
  -f filter='label:"good first issue" is:open'

gh api -X POST orgs/KarmaCummunity/projectsV2/2/views \
  -f name='Maintainer / blocked' -f layout='table' \
  -f filter='label:maintainer-only is:open'
```

Set **Contributor board** as the project default in the UI: project **⋯ → Settings →
Default view**.

Custom fields (optional): **Size** (S/M/L), **Area** (glowe-web/docs/a11y/i18n).

#### One-time: grant CLI project scope + bulk-add items

`@navesarussi` must refresh the GitHub CLI token (interactive browser):

```bash
gh auth switch --user navesarussi
gh auth refresh -h github.com -s project,read:project,repo,workflow,read:org
```

Then add contributor issues to project #2 and set Status=Todo:

```bash
for n in 704 726 727 728 729 730 731 732 733 734 735; do
  gh project item-add 2 --owner KarmaCummunity \
    --url "https://github.com/KarmaCummunity/KC/issues/$n"
done
for n in 708 709 710 712 713; do
  gh project item-add 2 --owner KarmaCummunity \
    --url "https://github.com/KarmaCummunity/KC/issues/$n"
done
```

Size/Area custom fields still require the project UI if GraphQL field APIs are unavailable.

### Scope guard (historical)

The former `ci-scope-guard.yml` workflow, which closed PRs that only touched
`app/apps/mobile/**`, no longer exists; mobile PRs are gated by `CI gate` like any other.

### Discussions

Categories: **Q&A**, **Ideas**, **Show and tell**, **Announcements** (maintainer).
Point newcomers from README / issue-template `config.yml` contact links.

Welcome thread: [Discussion #736](https://github.com/KarmaCummunity/KC/discussions/736) — pin manually in the UI (GraphQL pin API unavailable).

### Security tooling secrets (INFRA-OSS-4/5/6)

Workflows are committed; scans **skip gracefully** until secrets exist:

| Secret | Workflow | Obtain |
| --- | --- | --- |
| `SNYK_TOKEN` | `CI — Snyk` | https://app.snyk.io/account |
| `GITGUARDIAN_API_KEY` | `CI — GitGuardian` | GitGuardian dashboard → API |
| *(none)* | CodeRabbit | Install https://github.com/apps/coderabbitai on the repo |

Full matrix: [`SECURITY.md`](../../SECURITY.md) at repo root.

After a clean baseline, make a scan blocking by adding it to a lane behind `CI gate`
(judge-first, see § Adding a CI lane), never as a separate required check.

### Review SLA

Documented in `CONTRIBUTING.md`: aim to review external PRs within **3 business days**.
