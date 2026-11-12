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
4. Add the file name to `supabase/baseline/prod-allowed-migrations.txt` in the release that ships it to prod.

## CI after the cut-over

- `static` lane: migration chain, destructive SQL (every file except the generated baseline), baseline assembly, RPC contract (an object of launch tier `later` that the baseline lacks is tolerated and counted; a `core` / `wedge` one fails), D-228 guard unit tests. The temporary schema freeze (`KC_DB_SCHEMA_FREEZE`) is gone.
- `backend` lane: `supabase start` applies `supabase/migrations` on the real image; `scripts/run-baseline-tests.sh` builds an empty database, applies every migration, runs `supabase/tests`, and loads the reference and content seeds twice (idempotency + `check.sql`); RPC grants; `gen-baseline-types.mjs --check`; FSM catalog contract; sqlProbes and port contracts.
- Ledger guards (`ci-migration-drift`, `check-prod-ledger`) compare remote versions with the files in `supabase/migrations/` and now expect exactly the baseline (+ later files).

## kc-dev rebuild (one time, after a fresh backup)

1. `db-backup-dev.yml` (encrypted) and a local decrypted copy; kc-dev Auth settings saved outside the repository.
2. Reset kc-dev: drop the application schemas and objects and `supabase_migrations.schema_migrations`, delete `auth.users`. The project, API keys and Auth settings stay.
3. **Deploy** (normal path) applies `0001_baseline.sql`; `supabase db push` records exactly one ledger row.
4. **Seed KC dev** (`all`): reference, content, e2e members.
5. Vault secrets `kc_project_url` and `kc_service_role_key` are set on kc-dev (see below).
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

Supabase Vault is the encrypted secret store inside the database. The database needs two values to start Edge Functions from scheduled jobs and the outbox (through `pg_net`, an HTTP client in Postgres): the project URL and a service-role key. They cannot live in a migration or in the repository, so they are stored once per project with `vault.create_secret(<value>, 'kc_project_url')` and `vault.create_secret(<value>, 'kc_service_role_key')` and read at call time by `kc_private.invoke_edge_function` (from `vault.decrypted_secrets`). Without them the database still works; the four workers it starts (push dispatcher, account purge, storage orphan reconciliation, EXIF strip) are recorded as a warning in `ops.warnings` instead of running. Each project (kc-dev, kc-prod) has its own two secrets, set by the operator, never by a migration.

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
