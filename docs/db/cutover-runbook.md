# Production baseline cut-over: layout, rollback, kc-dev rebuild, Vault

Decision D-228 (approved by the owner 2026-11-11). Design: [target-design.md](./target-design.md) §10.

## What the repository looks like now

| Path | Role |
|---|---|
| `supabase/migrations/0001_baseline.sql` | The single baseline, generated from `supabase/schemas/`. Frozen: `node scripts/assemble-baseline.mjs --check` (static lane) fails when the two differ, and the destructive-SQL scan exempts only this generated file. |
| `supabase/migrations/NNNN_*.sql` (0002 and up) | Later changes: forward-only, expand → backfill → contract, scanned by `check-migration-safety`. |
| `supabase/migrations/archive/` | The retired chain `0001`–`0742`. History; never applied; ignored by the CLI, the chain check and the guards. |
| `supabase/schemas/` | Source of the baseline. Frozen as history. |
| `supabase/tests/` | pgTAP suites (were `supabase/baseline/tests/`). The legacy harness and per-migration tests are in `supabase/archive/tests-legacy/`. |
| `supabase/baseline/local/supabase_shim.sql` | Platform stand-in for plain Postgres (test runner only). |
| `supabase/baseline/prod-allowed-migrations.txt` | D-228 manifest. Lists `0001_baseline.sql`. Listing a file does **not** open prod: a PROD push stays blocked until `KC_PROD_SCHEMA_MODE=baseline` is set on `supabase-prod`. |
| `supabase/seed/{reference,content,e2e}/` | Idempotent seed loaders. Seeds are data, never migrations. |
| `supabase/archive/seed-kc-dev-demo/` | The retired fake dataset (posts, chats, follows), reference only. |

## Adding a schema change after the cut-over

1. `supabase/migrations/0002_<name>.sql` (next free number, see `docs/agents/MIGRATION_RANGES.md`).
2. A pgTAP file in `supabase/tests/`.
3. `node scripts/gen-baseline-types.mjs` to refresh `database.types.ts`.
4. The file name reaches `supabase/baseline/prod-allowed-migrations.txt` on merge: the numbering step (`scripts/migration-ids.mjs assign`) appends it. Listing a file does not open prod.

## CI after the cut-over

- `static` lane: migration chain, destructive SQL (every file except the generated baseline), baseline assembly, RPC contract (an object of launch tier `later` that the baseline lacks is tolerated and counted; a `core` / `wedge` one fails), D-228 guard unit tests. The temporary schema freeze (`KC_DB_SCHEMA_FREEZE`) is gone.
- `backend` lane: `supabase start` applies `supabase/migrations` on the real image; `scripts/run-baseline-tests.sh` builds an empty database, applies every migration, runs `supabase/tests`, and loads the reference and content seeds twice (idempotency + `check.sql`); RPC grants; `gen-baseline-types.mjs --check`; FSM catalog contract; sqlProbes and port contracts.
- Ledger guards (`ci-migration-drift`, `check-prod-ledger`) compare remote versions with the files in `supabase/migrations/` and now expect exactly the baseline (+ later files).

## Opening the release PR (`dev` → `main`)

- **Who opens it.** test-integrity and the CI gate need an approving review from an owner in `.github/owners.json` (read from `main`), and GitHub never lets an author approve their own PR. So the release PR is opened from a non-owner account (`karma-community-kc`), and the owner approves it.
- **Its CI runs on the newest real commit.** Since #2613 merges push no CI-skipped version bump to `dev`, so the head is normally a real commit. A PR whose head commit is CI-skipped still starts no `pull_request` run; if `dev` ends in one, the next real merge starts it.
- **The owner's approval binds to the PR's head SHA**, and the review-triggered gate reuses the `pull_request` CI run *of that SHA* (`scripts/ci-run-reuse.mjs`, read from `main`). A CI-skipped head has no such run, so an approval on it can never turn the gate green. Before asking for the approval, make sure `app/VERSION` on the head is above the latest `v*` tag (merge a version PR into `dev` if not) and merge nothing else into `dev` until `main` is merged.
- **The release E2E lane waits for the exact head.** Deploy puts the merge commit itself on dev web (no bump child since #2613), and `release / dev E2E on the release head` waits until dev serves that SHA (`scripts/smoke-deploy.mjs`).
- **kc-dev load.** Maestro, E2E nightly and the release E2E queue for a kc-dev test slot (`scripts/kc-dev-slot.mjs`, `KC_DEV_TEST_SLOTS`, default 2), so the release lane may wait for a running suite.
- **Merge it only with `scripts/release-merge.mjs`.** Run `GH_TOKEN=… node scripts/release-merge.mjs <pr> <head-sha>` (add `--dry-run` first). Never use the merge button or a bare `gh pr merge`. The first baseline release (#2296, 15 Nov 2026) hit two traps:
  - **Skip tokens in the squash message.** GitHub's default squash message lists every commit, including the version-bump commits, and those carry a CI-skip token. With that token on `main`, GitHub starts no push workflow: no CI, so the prod judge (`scripts/deploy-target.mjs`) has no push-event CI run to certify and Deploy (main) never asks for approval, and no sync-main-to-dev. The script squashes with the PR title plus a fixed body, and refuses any message with a skip token (`[skip ci]` and its variants, `skip-checks: true`).
  - **`dev` deleted on merge.** The release PR's head branch is `dev`. With the repo setting `delete_branch_on_merge`, GitHub deletes `dev` and retargets every open PR into `dev` onto `main`. The script turns that setting off for the merge and restores the old value afterwards, also when the merge fails. A separate ruleset without bypass actors (`dev: never deleted`) also blocks deleting `dev`.
  - **If it happens anyway:** recreate `refs/heads/dev` at the PR's head SHA, then move every PR with an `AutomaticBaseChangeSucceededEvent` (`dev` → `main`) back to `dev`. A `main` commit without a push CI run cannot be deployed: it needs a second release PR merged with the script.
- **After the merge: sync `main` into `dev` as a merge commit.** `sync-main-to-dev.yml` opens an ancestry-only PR. It must land as a merge commit (allow merge commits only for that merge, then turn them off again), because test-integrity fails closed when `main` is not an ancestor of `dev`.

## kc-dev rebuild (one time, after a fresh backup)

1. `db-backup-dev.yml` (encrypted) and a local decrypted copy; kc-dev Auth settings saved outside the repository.
2. Reset kc-dev: drop the application schemas and objects and `supabase_migrations.schema_migrations`, delete `auth.users`. The project, API keys and Auth settings stay.
3. **Deploy** (normal path) applies `0001_baseline.sql`; `supabase db push` records exactly one ledger row.
4. **Seed KC dev** (`all`): reference, content, e2e members.
5. Vault secrets `kc_project_url` and the caller slot applicable to that migration state are validated on kc-dev (see below). After `verified_edge_caller`, the caller slot is `kc_verified_service_role_key`; the baseline-only historical state uses `kc_service_role_key`.
6. Verify: ledger = baseline only, `pg_cron` / `pg_net` / `supabase_vault` present, Deploy and the nightly E2E green.

## First super admin

A database built from the baseline has no staff at all, and no RPC hands out `super_admin` (FR-ADMIN-016, FR-ADMIN-017), so until the first super admin exists nobody can grant any role. The operator creates that grant once per project (kc-dev after a rebuild, kc-prod after its first build), as follows:

1. The future super admin signs in to the app once, so their member row exists and their account is `active`.
2. The operator finds the member id (Supabase dashboard → Authentication → Users, or `select id from public.users where share_handle = '<handle>'` in the SQL editor).
3. In the SQL editor of that project (it runs as the database owner; a service-role connection works too), the operator runs `select kc_private.bootstrap_super_admin('<member id>');`. It returns the new grant id. The grant is audited (`admin_role_grant`).
4. The function refuses with `super_admin_exists` while an active super admin exists and with `target_not_active` for a member who is not active; signed-in members and signed-out callers cannot call it. Changing the super admin later means revoking the current grant by a direct database operation first (FR-ADMIN-006 AC2), then running step 3 again.

## Rollback

- **Before the merge:** nothing to undo; the PR is not merged and kc-dev is untouched.
- **After the merge, before the rebuild:** revert the merge commit on `dev`; kc-dev still runs the old chain and its ledger, so Deploy works again.
- **After the rebuild:** kc-dev data is the content seed plus e2e members; the pre-rebuild state is the encrypted backup of `db-backup-dev.yml` plus the local decrypted copy (restore with `psql` into a fresh project, then re-apply the old chain from `supabase/migrations/archive/`). kc-prod is not touched by any of this; its first build still needs the owner's `KC_PROD_SCHEMA_MODE=baseline` decision.

## Vault (what it is)

Supabase Vault is the encrypted secret store inside the database. Database jobs use `pg_net` and `kc_private.invoke_edge_function` to call Edge Functions with the project's URL and service credential. Values never belong in migrations, source, logs or messages.

The baseline-only historical state reads `kc_project_url` and `kc_service_role_key`. After the `verified_edge_caller` migration it reads `kc_project_url` and **only** `kc_verified_service_role_key`. The normal reviewed Deploy writer retrieves the existing credential with explicit reveal, requires two matching reads and a nonclaiming Auth-settings 200, then populates that verified slot. The migration does not copy an existing key, rotate keys, start a worker, enable a job or change containment. Missing/empty verified configuration leaves a warning and no HTTP request, even if an obsolete slot exists.

An older default-branch deployment copy may continue rewriting the obsolete slot. That cannot populate or replace the migrated worker's verified caller. If normal concurrency cancels the DEV-copy deployment before it populates the slot, a separately authorized normal Deploy dispatch on the CI-certified DEV ref is the bootstrap path. Do not substitute a seed/reseed, direct Vault SQL or a manual worker call. Verify the current verified slot and preserve the approved registry/cron/kick state afterward. Auth-settings 200 alone does not prove worker or delivery success.

DEV and PROD have separate projects, credentials and migration ledgers. This DEV repair is not proof of PROD adoption or permission to deploy, rotate, restore or re-enable anything there. A later PROD release must review its own migration and writer together under its separate approval.

## Still not in the baseline (all launch tier `later`)

| Id | What | Why it can wait |
|---|---|---|
| M12 | Knowledge topic graph | `world_knowledge_enabled` is off |
| M16 | Free feedback form | ships with the surveys hub |
| M17 | Survey statistics for admins | admin dashboard hidden |
| M19 | Back-office: tasks, CRM, timesheets (18 RPCs) | internal tools |
| M20 | KC support channels | money is a portal at launch (`world_money_enabled` off) |
| M21 | Organization finance summaries | money is a portal |
| M22 | WhatsApp bot, linking, admin console (33 objects) | functions not deployed |

Details and per-object notes: [app-migration-map.md](./app-migration-map.md).
