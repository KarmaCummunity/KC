-- 0346_feed_mv_cron_dirty | KC#879 — pg_cron refreshes feed MV only when dirty.

begin;

create or replace function public.cron_refresh_feed_open_posts_mv_if_dirty()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dirty boolean;
  v_rows bigint;
begin
  select dirty into v_dirty
    from public.feed_mv_refresh_state
   where singleton_id = 1;

  if coalesce(v_dirty, false) is not true then
    return 0;
  end if;

  v_rows := public.refresh_feed_open_posts_mv(true);
  return v_rows;
end;
$$;

comment on function public.cron_refresh_feed_open_posts_mv_if_dirty() is
  'KC#879: scheduled worker entrypoint; no-op when feed_mv_refresh_state.dirty is false.';

revoke all on function public.cron_refresh_feed_open_posts_mv_if_dirty() from public, authenticated, anon;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'feed_open_posts_mv_if_dirty') then
      perform cron.unschedule('feed_open_posts_mv_if_dirty');
    end if;
    perform cron.schedule(
      'feed_open_posts_mv_if_dirty',
      '*/2 * * * *',
      $sql$ select public.cron_refresh_feed_open_posts_mv_if_dirty(); $sql$
    );
  else
    raise notice
      'pg_cron not enabled — feed_open_posts_mv_if_dirty not scheduled. Enable pg_cron, then re-run 0346.';
  end if;
end $$;

commit;
