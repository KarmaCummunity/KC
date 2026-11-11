-- 0079_storage_orphan_reconciliation_cron | TD-122
--
-- Daily reconciliation: call the `reconcile-storage-orphans` Edge Function to
-- delete post-images bucket objects whose owning post no longer exists.
--
-- Why Edge Function instead of pure SQL: Storage.remove() must go through the
-- Supabase Storage API to clean up the actual S3 objects, not just the
-- storage.objects metadata row. A pg_net HTTP POST is the cron-safe bridge.
--
-- Depends on: pg_cron + pg_net (enabled in 0058_notifications_dispatcher_glue).
-- Depends on: DB GUCs set by 0058 operator steps:
--   app.settings.functions_url     (e.g. https://<ref>.supabase.co)
--   app.settings.service_role_key
--
-- Schedule: daily at 05:00 UTC (after 03:00 suspension cron, 04:00 outbox cron).

begin;

-- The outer DO block uses `$mig$` so its closing tag can't collide with the
-- inner cron-body `$$ ... $$` string literal (Supabase CLI's local parser was
-- closing the outer quote on the first inner `$$` and failing with
-- "syntax error at or near 'do'"). Postgres tolerated the nesting on prod via
-- Management API, but the fresh-local-DB CI check uses the CLI tokenizer.
do $mig$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'storage_orphan_reconciliation') then
      perform cron.unschedule('storage_orphan_reconciliation');
    end if;

    perform cron.schedule(
      'storage_orphan_reconciliation',
      '0 5 * * *',
      $cron$
      do $body$
      declare
        functions_url text := current_setting('app.settings.functions_url', true);
        service_key   text := current_setting('app.settings.service_role_key', true);
      begin
        if functions_url is null or functions_url = '' then
          raise warning 'storage_orphan_reconciliation: app.settings.functions_url not set — skipping';
          return;
        end if;
        perform net.http_post(
          url     := functions_url || '/functions/v1/reconcile-storage-orphans',
          headers := jsonb_build_object(
            'Content-Type',  'application/json',
            'Authorization', 'Bearer ' || service_key
          ),
          body    := '{}'::jsonb
        );
      end;
      $body$;
      $cron$
    );
  end if;
end;
$mig$;

commit;
