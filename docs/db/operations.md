# Database — operations runbook (production baseline)

How the baseline runs in production: scheduled jobs, health checks, retention, calling
Edge Functions, storage, backups. Source: `supabase/schemas/95_platform/`. Design:
[`target-design.md`](./target-design.md) §4–§7.

Everything here is configuration **in tables**, so "what runs, how often, what is kept,
what is limited" is answered by a `select`, and a change is one row.

| Question | Table | Applied by |
| --- | --- | --- |
| What runs in the background? | `kc_private.scheduled_jobs` | `kc_private.jobs_sync()` → `pg_cron` (automatic on every change of the table) |
| Did it run? | `ops.job_runs` | `kc_private.job_run(name)` wraps every job |
| Is anything wrong? | `ops.health_checks` | `select * from ops.run_health_checks()` |
| How long is data kept? | `kc_private.retention_rules` | `kc_private.retention_run(rule)` |
| How often may a member repeat a write? | `kc_private.rate_limits` | `kc_private.rate_limit_enforce(action, member)` |
| Which features are on? | `public.app_flags` | `public.admin_set_app_flag(key, enabled, description)` |

## 1. Monitoring

Call with the service role every 5 minutes and alert on any row with `status = 'failing'`:

```sql
select check_name, status, measured, max_allowed, detail, failure_means
  from ops.run_health_checks();
```

`skipped` means the thing measured is not installed on that server (local PostgreSQL).

| Check | Fails when | What it means / first action |
| --- | --- | --- |
| `outbox_backlog` | a topic's oldest due event waited > 5 min | A consumer is down or too slow. `select * from ops.outbox_stats;` then check the job (or Edge Function) that consumes the topic — §2 |
| `outbox_exhausted` | an unprocessed event has ≥ 5 attempts | A consumer keeps failing on it. Read `last_error` in `kc_private.outbox_events`, fix the cause; the event is retried by itself |
| `outbox_stale_claims` | an event was claimed > 15 min ago and never confirmed | A worker died mid-batch. One-off: nothing to do (it is retried). Growing: the worker times out — look at its logs |
| `jobs_failing` | the latest run of an enabled job failed | `select * from ops.job_runs where job_name = '…' order by finished_at desc limit 5;` — `error` holds the SQLSTATE and message, or `cancelled (timeout …)` |
| `jobs_late` | an enabled job has no successful run within its `alert_after` | The scheduler is down, the job is missing from `pg_cron`, or it fails every time (then `jobs_failing` fires too) |
| `jobs_unscheduled` | an enabled job is missing from `cron.job` | `select kc_private.jobs_sync();` |
| `partitions_next_month` | `feed_impressions`, `notifications` or `audit.events` has no partition for next month | `select kc_private.partitions_ensure();` and find out why the daily job did not |
| `default_partition_rows` | a row sits in a default partition | A month started without its partition. Rows stay readable. Move them out before creating that month's partition (PostgreSQL refuses to create a partition whose rows are in the default one) |
| `push_retries` | > 20 pushes are past their third attempt | The push provider refuses pushes: outage, expired `EXPO_ACCESS_TOKEN`, or many dead devices |
| `counter_drift` | the nightly reconciliation repaired a counter in the last 24 h | A counter trigger has a bug. `select * from ops.counter_drift order by detected_at desc;` |
| `warnings` | a warning was recorded in the last 24 h | `select * from ops.warnings;` — see below. Delete the row once handled |
| `edge_function_responses` | an Edge Function call from the database failed or answered ≥ 400 in the last hour | `select * from net._http_response order by created desc limit 20;` — 401 means the Vault key is wrong (§5) |

Warnings (`ops.warnings.key`):

| Key | Meaning |
| --- | --- |
| `edge_invocation_unavailable` | `pg_net` or Vault is not installed: no Edge Function is started from the database |
| `edge_invocation_unconfigured` | A Vault secret of §5 is missing |
| `edge_invocation_failed:<function>` | The HTTP call could not be queued (the SQLSTATE is in `detail`) |
| `rate_limit_unconfigured:<action>` | Code enforces a limit that has no row in `kc_private.rate_limits`; the write was allowed |

Also watch: slow statements (`pg_stat_statements`), and `cron.job_run_details` for a job that
did not even reach the wrapper (connection failure).

## 2. Jobs

`select name, schedule, timeout, alert_after, enabled, description from kc_private.scheduled_jobs order by name;`
Schedules are UTC. Every job is cancelled at its `timeout` and recorded as failed.

| Job | Schedule | Does |
| --- | --- | --- |
| `chat_system_messages` | every 10 s | outbox `chat_system_message` → system lines in chats |
| `audit_consume` | every minute | outbox `audit` → `audit.events` |
| `moderation_consume` | every minute | outbox `moderation` → moderation queue |
| `push_dispatch` | every minute | starts Edge Function `dispatch-notification` when a push queue has due events (new events also start it at once, §5) |
| `account_purge` | 03:30 | starts `purge-deleted-accounts` |
| `storage_orphans` | 05:00 | starts `reconcile-storage-orphans` |
| `exif_strip` | 02:30 | starts `strip-exif` |
| `standing_orders_charge` | hourly :10 | starts `subscriptions-charger` |
| `handoff_reservation_expiry` | every 10 min | unanswered reservations and booking requests |
| `handoff_no_show` | hourly :45 | confirmed item handoffs past their pickup time |
| `post_expiry` | every 15 min | posts whose time has come, every world |
| `housing_not_completed` | every 30 min | stays nobody closed |
| `food_expiry_alert` | hourly :05 | food about to expire |
| `ride_series_materialize` | 02:00 | occurrences of recurring rides, 30 days ahead |
| `lift_expired_suspensions` | every 15 min | suspensions whose period ended |
| `posts_purge` | 04:00 | hard delete of deleted posts past the 7-day grace period |
| `partitions_ensure` | 03:05 | this and next month's partitions |
| `retention_*` (7 jobs) | hourly / daily | §4 |
| `user_stats_reconcile`, `post_stats_reconcile` | 01:15, 01:45 | recompute counters, record drift |

Add a job: one row in `supabase/schemas/95_platform/900_job_registry.sql` (a migration after
cut-over): `name`, `schedule`, `command` (one `select kc_private.<function>(…)`), `timeout`,
`alert_after`, `description`. The insert schedules it.

Pause a job: `update kc_private.scheduled_jobs set enabled = false where name = '…';`
(unscheduled at once; the health checks ignore a disabled job). Run one by hand:
`select kc_private.job_run('…');` — true on success, and the run is recorded.

## 3. Rate limits and feature flags

Limits: `select * from kc_private.rate_limits;`. Over the limit the write raises
`rate_limited` (P0001, the action in DETAIL). Only a member's own request is counted — jobs,
the service role and staff acting for a member are not. Change a limit with an `update` of
its row. Add one: a row in `020_rate_limit.sql` plus one line in the write path,
`perform kc_private.rate_limit_enforce('<action>', <member id>);` — or, for a table members
insert into directly, a `kc_private.rate_limit_guard('<action>', '<member column>')` trigger.

Flags: rows of `public.app_flags` are seed data (`world_<slug>_enabled`, …). The super admin
switches or creates one with `select public.admin_set_app_flag('world_rides_enabled', true, 'Rides world');`
(audited as `app_flag_set`). The app receives all flags in `bootstrap_session().flags`; SQL
asks `kc_access.flag_enabled('<key>')` (a missing flag is off).

## 4. Retention

`select * from kc_private.retention_rules;` — the one list.

| Rule | Keep | Enforced by |
| --- | --- | --- |
| `outbox_processed` | 7 days | job `retention_outbox` (unprocessed events are never purged) |
| `notifications` (+ dedupe ledger) | 180 days | job `retention_notifications`, partition drop |
| `feed_impressions` | 90 days | job `retention_feed_impressions`, partition drop |
| `audit_events` | 24 months | job `retention_audit`, partition drop (a shorter period is refused) |
| `job_runs`, `ops_warnings`, `counter_drift` | 30 / 30 / 90 days | job `retention_ops` |
| `rate_limit_counters` | 1 hour after expiry | job `retention_rate_limits` |
| `cron_run_history` | 7 days | job `retention_cron_history` |
| `posts_deleted` | 7 days | deadline stamped at delete; job `posts_purge` |
| `accounts_pending_deletion` | 30 days | deadline stamped at request; Edge Function `purge-deleted-accounts` |
| `billing_after_account_deletion` | undecided | nothing is purged (design §12 Q5) |

Change a period of a runnable rule: `update kc_private.retention_rules set keep = interval '…' where name = '…';`.

Account purge, per account past its grace period: tombstone + money records detached
(`kc_private.account_purge_prepare`) → the member's folder removed from every bucket →
auth identity deleted, rows cascade (`kc_private.account_purge_finish`). Every step is
repeatable; an account stays due until the last step succeeded.

## 5. Edge Functions started from the database

`kc_private.invoke_edge_function(name, body)` queues an HTTP POST with `pg_net`, authorised
with the service-role key read from **Supabase Vault** at call time. Required once per
project (names only — values are never written in the repository):

| Vault secret name | Value |
| --- | --- |
| `kc_project_url` | the project's API URL |
| `kc_service_role_key` | the project's service-role key |

```sql
select vault.create_secret('<value>', 'kc_project_url');
select vault.create_secret('<value>', 'kc_service_role_key');
```

Rotate the key: `select vault.update_secret(id, '<new value>') from vault.secrets where name = 'kc_service_role_key';`.
Extensions required on the project: `pg_cron`, `pg_net`, `supabase_vault`.

Push latency: an insert of a `notification` outbox event starts `dispatch-notification`
immediately, at most once every 2 seconds (`kc_private.edge_function_kicks`); the start never
waits and never fails the member's transaction. The every-minute job is the safety net.

Edge Function secrets (names): `SUPABASE_DB_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`EXPO_ACCESS_TOKEN` (dispatcher).

## 6. Storage

| Bucket | Public | Limit | Types | Path |
| --- | --- | --- | --- | --- |
| `avatars` | yes | 512 KB | JPEG | `<user_id>/avatar.jpg` |
| `post-images` | yes | 8 MB | JPEG, PNG | `<user_id>/…` (declared in `30_social/900_storage.sql`) |
| `chat-media` | no | 5 MB | JPEG, PNG, WebP | `<user_id>/<chat_id>/<file>`; signed URLs, members of the chat only |

Add a bucket in `95_platform/090_storage.sql` (after cut-over: a migration): the
`storage.buckets` row **with** `file_size_limit` and `allowed_mime_types`, policies that
tie writes to the folder `(storage.foldername(name))[1] = auth.uid()`, and for a private
bucket a `select` policy built on a `kc_access` predicate. If its files are recorded row by
row, teach `kc_private.storage_orphan_keys` about it.

## 7. Backups and restore drill

- **PITR** on kc-prod, 7-day window minimum; verify it is on after cut-over and after any plan change.
- **Logical dump** to private storage before every deploy (existing Deploy step).
- **Restore drill, each quarter**: restore the latest dump (or a PITR clone) into a scratch
  project; run `select * from ops.run_health_checks();` and the pgTAP suite's read-only
  smoke queries; check row counts of `users`, `posts`, `messages`, `billing.payments` against
  production; confirm `select kc_private.jobs_sync();` reports the jobs (then pause them:
  `update kc_private.scheduled_jobs set enabled = false;`) so the clone sends no push and
  purges nothing; record the time the restore took. Delete the scratch project.
- A restored clone has the Vault secrets of production: disable the jobs **before** anything else.

## 8. After cut-over — what to watch

1. Day 0: `select * from ops.run_health_checks();` — `jobs_unscheduled` ok; within the hour
   every frequent job has a `succeeded` row in `ops.job_runs`; within 36 h every daily one
   (`jobs_late` only reports a job after its first `alert_after`).
2. `warnings` must be empty: `edge_invocation_unconfigured` means §5 was not done.
3. `select * from ops.outbox_stats;` — no topic with a growing `pending`. A topic with events
   and no consumer shows up in `outbox_backlog` after 5 minutes.
4. First night: `counter_drift` stays empty; `ops.job_runs` shows the reconcile durations.
5. First month turn: `partitions_next_month` and `default_partition_rows` stay ok.
6. `rate_limited` errors in the app's error tracking: a limit set too low for real use.
