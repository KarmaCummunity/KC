-- 0058_notifications_dispatcher_glue | P1.5 — webhook + crons.
--
-- The Database Webhook on notifications_outbox INSERT must be created via
-- the Supabase dashboard UI (Database → Webhooks) because the management
-- API for webhooks isn't exposed to SQL. We enable the extensions and
-- create the crons here; the operator wires the webhook after applying.
--
-- Operator steps after applying this migration:
--   1. Dashboard → Database → Webhooks → Create:
--      • Name:     notify_dispatch_on_outbox_insert
--      • Schema:   public
--      • Table:    notifications_outbox
--      • Events:   INSERT
--      • Type:     Supabase Edge Functions
--      • Function: dispatch-notification
--      • HTTP Headers: { "Authorization": "Bearer <SERVICE_ROLE_KEY>" }
--   2. Save.
--   3. Set DB GUCs (one-off, requires superuser or dashboard SQL editor):
--      alter database postgres set app.settings.functions_url = 'https://<ref>.supabase.co';
--      alter database postgres set app.settings.service_role_key = '<service-role-key>';
--      select pg_reload_conf();
--
-- Note (verified 2026-05-14): neither pg_cron nor pg_net was installed in
-- the project before this migration; existing cron references in 0016
-- and 0045 may not have been firing. Both extensions are enabled here.

begin;

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;

-- Daily 04:00 UTC: TTL cleanup of outbox.
select cron.schedule(
  'notifications_outbox_ttl',
  '0 4 * * *',
  $$ delete from public.notifications_outbox where expires_at < now(); $$
);

-- Daily 04:00 UTC: prune devices not seen in 90 days (FR-NOTIF-015 AC4).
select cron.schedule(
  'notifications_token_prune',
  '0 4 * * *',
  $$ delete from public.devices where last_seen_at < (now() - interval '90 days'); $$
);

-- Every minute: retry pending outbox rows whose webhook delivery may have failed.
-- The webhook itself has dashboard-level retries, but this is the operator-visible
-- backstop. Uses pg_net to POST the row back to the dispatcher.
select cron.schedule(
  'notifications_retry_pending',
  '* * * * *',
  $$
  do $body$
  declare r record;
  begin
    for r in
      select notification_id from public.notifications_outbox
      where dispatched_at is null
        and attempts < 3
        and created_at > now() - interval '1 hour'
      limit 50
    loop
      perform net.http_post(
        url     := current_setting('app.settings.functions_url', true) || '/functions/v1/dispatch-notification',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
        ),
        body    := (
          select jsonb_build_object('type', 'RETRY', 'table', 'notifications_outbox', 'record', to_jsonb(n))
          from public.notifications_outbox n
          where n.notification_id = r.notification_id
        )
      );
    end loop;
  end
  $body$;
  $$
);

commit;
