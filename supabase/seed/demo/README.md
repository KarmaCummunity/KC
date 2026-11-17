# Demo data tools (kc-dev only)

The functions behind the admin portal's **Demo data** screen (FR-ADMIN-031): demo counts,
"Hide demo data" (a wipe) and "Show demo data" (a restore). **DEV ONLY**: kc-dev, a local stack or a scratch
test database. They are a seed, not a migration, so kc-prod never gets them
(`docs/db/target-design.md` §6, §9; decision `D-239`).

| File | What |
| --- | --- |
| `install.sql` | Creates or replaces the tools (`lib/*.sql`). No marker, no data. Safe to run again |
| `load.sql` | `install.sql`, then sets the dev marker; with `kc.seed_password` set it also restores the demo data at once. Refuses unless `kc.seed_target = 'dev'` |
| `wipe.sql` | Deletes the demo data from the command line. Refuses unless `kc.seed_target = 'dev'` |
| `lib/10_scope.sql` | `kc_private.demo_data_state` (dev marker, password hash, operation lock), who is demo, `can_manage_demo_data` |
| `lib/20_wipe.sql` … `lib/60_seed_orgs.sql` | The phases: wipe content, wipe accounts, members, items, rides, worlds (food, animals, knowledge and time posts of every active kind), social, chats, orgs |
| `lib/70_operations.sql` | The stepped driver (`demo_advance`) and the one-transaction runner (`demo_run_all`) |
| `lib/80_admin_rpcs.sql` | `admin_demo_data_status`, `admin_wipe_demo_data_step`, `admin_seed_demo_data_step` |

On kc-dev nothing has to be run: every dev deploy installs the tools after the migrations
(`deploy-db.yml`, step **Demo-data tools (kc-dev only)**), so they always match `dev`. Then Admin →
Demo data → **Show demo data** / **Hide demo data**. Between deploys: Actions → **Seed KC dev**,
action `demo`.
Locally (the paths in the files are relative, so pass the file, not stdin):

```bash
psql "$DB_URL" -v ON_ERROR_STOP=1 --single-transaction \
  -c "select set_config('kc.seed_target', 'dev', false)" -f supabase/seed/demo/load.sql
```

What a restore creates: 200 members `demoN@seed.kc.test` (`app_metadata.demo = true`), 600 item
posts, 120 rides, about 1,600 follows, 400 saved posts, 150 chats and three `[DEMO]` nonprofits.
The e2e members (`supabase/seed/e2e`) carry no `demo` flag and are never touched. Tests:
`supabase/tests/110_demo_data.sql`.
