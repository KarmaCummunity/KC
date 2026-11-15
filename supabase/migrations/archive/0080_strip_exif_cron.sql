-- 0080_strip_exif_cron | TD-23
--
-- Daily server-side EXIF sweep for the `post-images` bucket.
-- Calls the `strip-exif` Edge Function via pg_net at 02:30 UTC to catch
-- any JPEG that still carries EXIF metadata (defense-in-depth; the mobile
-- client already strips via JPEG re-encode per P0.4-FE).
--
-- Depends on: pg_cron + pg_net (0058), DB GUCs app.settings.functions_url
-- and app.settings.service_role_key (operator step in 0058).

begin;

-- Same dollar-quote nesting issue as 0079: outer `do $$` collides with the
-- inner cron-body `$$` and the Supabase CLI's local parser closes the outer
-- quote prematurely. Outer uses `$mig$` and the inner cron body uses `$cron$`
-- so neither tag collides.
do $mig$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'strip_exif_daily') then
      perform cron.unschedule('strip_exif_daily');
    end if;

    perform cron.schedule(
      'strip_exif_daily',
      '30 2 * * *',
      $cron$
      do $body$
      declare
        functions_url text := current_setting('app.settings.functions_url', true);
        service_key   text := current_setting('app.settings.service_role_key', true);
      begin
        if functions_url is null or functions_url = '' then
          raise warning 'strip_exif_daily: app.settings.functions_url not set — skipping';
          return;
        end if;
        perform net.http_post(
          url     := functions_url || '/functions/v1/strip-exif',
          headers := jsonb_build_object(
            'Content-Type',  'application/json',
            'Authorization', 'Bearer ' || service_key
          ),
          body    := '{"lookbackHours":25}'::jsonb
        );
      end;
      $body$;
      $cron$
    );
  end if;
end;
$mig$;

commit;
