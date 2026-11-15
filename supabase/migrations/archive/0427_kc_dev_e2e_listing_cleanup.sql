-- 0427_kc_dev_e2e_listing_cleanup | Daily cleanup of e2e-created listings (kc-dev only).
--
-- The Playwright QA suite (tests/e2e) runs against kc-dev as the seed users and leaves its
-- posts / listings behind ("[e2e 2026-...] ..." run tags, "e2e-..." smoke titles). They pile up
-- (21 open on user1 after a few runs) and pollute the feed and matching v2.
--
-- kc_dev_cleanup_e2e_listings(min_age) deletes, older than min_age (default 12 h so a running
-- suite never loses its own data):
--   * posts, ride_listings and native/ingested listings
--   * whose title carries an e2e run tag
--   * owned by @seed.kc.test users only.
-- Each row is deleted on its own so one FK conflict cannot block the rest.
-- Guarded twice: the function returns {"skipped":"not_kc_dev"} unless the kc-dev fake seed is
-- present (>= 100 seed users, same rule as 0400/0426), and the daily pg_cron job is only
-- scheduled where that seed exists. Prod never has those users, so this is a no-op there.

begin;

create or replace function public.kc_dev_is_seeded()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select count(*) >= 100
    from auth.users
   where email like '%@seed.kc.test'
     and coalesce(raw_app_meta_data->>'seed', '') = 'true';
$$;

create or replace function public.kc_dev_is_e2e_title(p_title text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_title, '') ~* '^\s*\[e2e [0-9]{4}-' or coalesce(p_title, '') ~* '^\s*e2e-';
$$;

create or replace function public.kc_dev_cleanup_e2e_listings(p_min_age interval default interval '12 hours')
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_cutoff timestamptz := now() - greatest(coalesce(p_min_age, interval '12 hours'), interval '1 hour');
  v_posts  int := 0;
  v_rides  int := 0;
  v_native int := 0;
  v_failed int := 0;
  v_id     uuid;
begin
  if not public.kc_dev_is_seeded() then
    return jsonb_build_object('skipped', 'not_kc_dev');
  end if;

  for v_id in
    select p.post_id from public.posts p join auth.users a on a.id = p.owner_id
     where a.email like '%@seed.kc.test' and p.created_at < v_cutoff and public.kc_dev_is_e2e_title(p.title)
  loop
    begin
      delete from public.posts where post_id = v_id;
      v_posts := v_posts + 1;
    exception when others then
      v_failed := v_failed + 1;
    end;
  end loop;

  for v_id in
    select r.ride_id from public.ride_listings r join auth.users a on a.id = r.owner_id
     where a.email like '%@seed.kc.test' and r.created_at < v_cutoff and public.kc_dev_is_e2e_title(r.title)
  loop
    begin
      delete from public.ride_listings where ride_id = v_id;
      v_rides := v_rides + 1;
    exception when others then
      v_failed := v_failed + 1;
    end;
  end loop;

  for v_id in
    select l.listing_id from public.listings l join auth.users a on a.id = l.owner_id
     where a.email like '%@seed.kc.test' and l.origin in ('native', 'ingestion')
       and l.created_at < v_cutoff and public.kc_dev_is_e2e_title(l.title)
  loop
    begin
      delete from public.listings where listing_id = v_id;
      v_native := v_native + 1;
    exception when others then
      v_failed := v_failed + 1;
    end;
  end loop;

  return jsonb_build_object('posts', v_posts, 'ride_listings', v_rides, 'listings', v_native,
                            'failed', v_failed, 'cutoff', v_cutoff);
end;
$$;

comment on function public.kc_dev_cleanup_e2e_listings(interval) is
  'kc-dev only: delete e2e-run listings/posts of @seed.kc.test users older than min_age. No-op without the kc-dev seed.';

revoke all on function public.kc_dev_is_seeded() from public, anon, authenticated;
revoke all on function public.kc_dev_is_e2e_title(text) from public, anon, authenticated;
revoke all on function public.kc_dev_cleanup_e2e_listings(interval) from public, anon, authenticated;
grant execute on function public.kc_dev_cleanup_e2e_listings(interval) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'kc_dev_e2e_cleanup') then
      perform cron.unschedule('kc_dev_e2e_cleanup');
    end if;
    if public.kc_dev_is_seeded() then
      -- 03:30 UTC (06:30 Asia/Jerusalem summer), after the nightly e2e run at 01:00 UTC.
      perform cron.schedule('kc_dev_e2e_cleanup', '30 3 * * *',
                            $job$select public.kc_dev_cleanup_e2e_listings(interval '12 hours')$job$);
    else
      raise notice '0427: no kc-dev seed detected - cleanup job not scheduled';
    end if;
  end if;
end $$;

commit;
