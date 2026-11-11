-- Platform · the job registry (vocabulary of the scheduler)
--
-- Every background job of the product, one row each. A module that adds a sweep, a queue
-- consumer or a retention function adds its row here; the insert reconciles pg_cron in
-- the same transaction (trigger scheduled_jobs_sync). Schedules are UTC.
--
-- `alert_after` is the longest the job may go without a successful run before the health
-- check `jobs_late` fails — about three periods for frequent jobs, a day and a half for
-- daily ones.

insert into kc_private.scheduled_jobs (name, schedule, command, timeout, alert_after, description) values
  -- Queue consumers (outbox topics handled inside the database).
  ('chat_system_messages', '10 seconds', 'select kc_private.chat_system_messages_process()',
   interval '30 seconds', interval '5 minutes', 'Outbox topic chat_system_message: writes system lines into chats.'),
  ('chat_moderation', '* * * * *', 'select kc_private.chat_moderation_process()',
   interval '50 seconds', interval '10 minutes', 'Outbox topic moderation_target: hides and restores chats under review.'),
  ('audit_consume', '* * * * *', 'select kc_private.audit_consume_outbox()',
   interval '50 seconds', interval '10 minutes', 'Outbox topic audit: writes audit.events.'),
  ('moderation_consume', '* * * * *', 'select kc_private.moderation_consume_outbox()',
   interval '50 seconds', interval '10 minutes', 'Outbox topic moderation: fills the moderation queue.'),

  -- Edge Function workers started from the database.
  ('push_dispatch', '* * * * *', 'select kc_private.push_dispatch_tick()',
   interval '20 seconds', interval '10 minutes',
   'Safety net of the push dispatcher (dispatch-notification); new events also start it at once.'),
  ('account_purge', '30 3 * * *', $$select kc_private.invoke_edge_function('purge-deleted-accounts')$$,
   interval '20 seconds', interval '36 hours', 'Starts purge-deleted-accounts: accounts past their 30-day grace period.'),
  ('storage_orphans', '0 5 * * *', $$select kc_private.invoke_edge_function('reconcile-storage-orphans')$$,
   interval '20 seconds', interval '36 hours', 'Starts reconcile-storage-orphans: files no row references.'),
  ('exif_strip', '30 2 * * *', $$select kc_private.invoke_edge_function('strip-exif')$$,
   interval '20 seconds', interval '36 hours', 'Starts strip-exif: second pass over recently uploaded post images.'),
  ('standing_orders_charge', '10 * * * *', $$select kc_private.invoke_edge_function('subscriptions-charger')$$,
   interval '20 seconds', interval '4 hours', 'Starts subscriptions-charger: standing orders whose charge is due.'),

  -- Time-driven state moves.
  ('handoff_reservation_expiry', '*/10 * * * *', 'select kc_private.handoff_reservation_expiry_sweep()',
   interval '2 minutes', interval '40 minutes', 'Reservations and booking requests nobody confirmed in time.'),
  ('handoff_no_show', '45 * * * *', 'select kc_private.handoff_no_show_sweep()',
   interval '2 minutes', interval '4 hours', 'Confirmed item handoffs whose pickup time passed.'),
  ('post_expiry', '*/15 * * * *', 'select kc_private.post_expiry_sweep()',
   interval '3 minutes', interval '1 hour', 'Open and paused posts whose time has come, in every world.'),
  ('housing_not_completed', '*/30 * * * *', 'select kc_private.housing_not_completed_sweep()',
   interval '2 minutes', interval '2 hours', 'Stays nobody closed after check-out.'),
  ('food_expiry_alert', '5 * * * *', 'select kc_private.food_expiry_alert_sweep()',
   interval '2 minutes', interval '4 hours', 'Food offers about to expire: urgency and owner alert.'),
  ('event_reminder', '7 * * * *', 'select kc_private.event_reminder_sweep()',
   interval '2 minutes', interval '4 hours', 'Confirmed event registrants: the day-before reminder.'),
  ('event_attendance_prompt', '17 * * * *', 'select kc_private.event_attendance_prompt_sweep()',
   interval '2 minutes', interval '4 hours', 'Organizers of ended events: mark the attendance.'),
  ('ride_series_materialize', '0 2 * * *', 'select kc_private.ride_series_materialize()',
   interval '10 minutes', interval '36 hours', 'Publishes the missing occurrences of recurring rides, 30 days ahead.'),
  ('lift_expired_suspensions', '*/15 * * * *', 'select kc_private.lift_expired_suspensions()',
   interval '2 minutes', interval '1 hour', 'Ends suspensions whose period is over.'),
  ('posts_purge', '0 4 * * *', 'select kc_private.posts_purge()',
   interval '10 minutes', interval '36 hours', 'Hard delete of posts deleted without a recipient, past their grace period.'),

  -- Partitions, retention, reconciliation.
  ('partitions_ensure', '5 3 * * *', 'select kc_private.partitions_ensure()',
   interval '2 minutes', interval '36 hours', 'This and next month''s partitions of feed_impressions, notifications, audit.events.'),
  ('retention_outbox', '20 * * * *', $$select kc_private.retention_run('outbox_processed')$$,
   interval '5 minutes', interval '4 hours', 'Removes processed outbox events past their retention.'),
  ('retention_rate_limits', '*/15 * * * *', $$select kc_private.retention_run('rate_limit_counters')$$,
   interval '1 minute', interval '1 hour', 'Removes expired rate-limit counters.'),
  ('retention_notifications', '0 4 * * *', $$select kc_private.retention_run('notifications')$$,
   interval '10 minutes', interval '36 hours', 'Drops notification partitions and dedupe keys past 180 days.'),
  ('retention_feed_impressions', '10 4 * * *', $$select kc_private.retention_run('feed_impressions')$$,
   interval '10 minutes', interval '36 hours', 'Drops feed impression partitions past 90 days.'),
  ('retention_audit', '20 4 * * *', $$select kc_private.retention_run('audit_events')$$,
   interval '10 minutes', interval '36 hours', 'Drops audit partitions past 24 months.'),
  ('retention_ops', '30 4 * * *', $$select kc_private.retention_run('job_runs')$$,
   interval '5 minutes', interval '36 hours', 'Trims ops.job_runs, ops.warnings and ops.counter_drift.'),
  ('retention_cron_history', '40 4 * * *', $$select kc_private.retention_run('cron_run_history')$$,
   interval '5 minutes', interval '36 hours', 'Trims pg_cron''s own run log.'),
  ('user_stats_reconcile', '15 1 * * *', 'select kc_private.user_stats_reconcile()',
   interval '15 minutes', interval '36 hours', 'Recomputes member counters; drift goes to ops.counter_drift.'),
  ('post_stats_reconcile', '45 1 * * *', 'select kc_private.post_stats_reconcile()',
   interval '15 minutes', interval '36 hours', 'Recomputes post engagement counters; drift goes to ops.counter_drift.');

-- Jobs of the karma, matching, activity and research modules.
insert into kc_private.scheduled_jobs (name, schedule, command, timeout, alert_after, description) values
  ('karma_consume', '* * * * *', 'select kc_private.karma_process()',
   interval '50 seconds', interval '10 minutes', 'Outbox topic karma: writes the karma ledger and the member totals.'),
  ('karma_reconcile', '30 1 * * *', 'select kc_private.karma_reconcile()',
   interval '10 minutes', interval '36 hours', 'Recomputes karma totals from the ledger and records drift.'),
  ('match_process', '*/2 * * * *', 'select kc_private.match_process()',
   interval '100 seconds', interval '15 minutes', 'Outbox topic match: computes candidates for new and edited posts and announces them.'),
  ('community_stats_refresh', '* * * * *', 'select kc_private.community_stats_refresh()',
   interval '30 seconds', interval '10 minutes', 'Refreshes the one-row community counters shown on the home screen.'),
  ('user_active_days_purge', '50 4 * * *', 'select kc_private.user_active_days_purge()',
   interval '5 minutes', interval '36 hours', 'Removes active-day rows older than the retention window.'),
  ('embed_worker', '*/2 * * * *', $$select kc_private.invoke_edge_function('embed-worker')$$,
   interval '20 seconds', interval '15 minutes', 'Starts embed-worker: embeddings for new and edited posts.'),
  ('match_rerank', '*/5 * * * *', $$select kc_private.invoke_edge_function('match-rerank')$$,
   interval '20 seconds', interval '30 minutes', 'Starts match-rerank: language-model scoring of fresh match candidates.'),
  ('research_salt_rotate', '15 0 * * *', $$select kc_private.invoke_edge_function('rotate-research-salt')$$,
   interval '20 seconds', interval '36 hours', 'Starts rotate-research-salt: daily rotation of the public research hashing salt.');
