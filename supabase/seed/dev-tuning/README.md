# Job tuning (kc-dev only)

kc-dev runs on the smallest compute tier. The migrations carry production's job schedules and
retention periods; `load.sql` overrides the ones kc-dev needs lighter (decision
`D-243` in `docs/SSOT/DECISIONS.md`). **DEV ONLY**: it refuses to run
unless the session sets `kc.seed_target = 'dev'`.

| What | kc-dev | Production (migrations) | Issue |
| --- | --- | --- | --- |
| `ops.job_runs` retention (`retention_rules.job_runs`) | 7 days | 30 days | #2492 |
| pg_cron run log retention (`retention_rules.cron_run_history`) | 1 day | 7 days | #2492 |
| `chat_system_messages` schedule | 30 seconds | 10 seconds | #2488 |
| `community_stats_refresh` schedule | every 10 minutes | every minute | #2481 |
| Matching scan per run (`matching_settings.scan_limit`) | 200 posts | 500 posts | #2494 |

## Run

Nothing to run: every dev deploy applies it after the migrations (`deploy-db.yml`, step
**Job tuning (kc-dev only)**). It is idempotent, so a second run changes nothing. By hand, against
kc-dev only:

```bash
psql "$KC_DEV_DB_URL" -v ON_ERROR_STOP=1 --single-transaction \
  -c "select set_config('kc.seed_target', 'dev', false)" -f supabase/seed/dev-tuning/load.sql
```

Test: `supabase/tests/128_dev_tuning.sql`.
