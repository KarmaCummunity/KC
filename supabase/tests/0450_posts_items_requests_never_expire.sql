-- 0450 — D21 / D59 (docs/spec/07_cross_cutting_systems.md §7.1): items and
-- all requests have no expiry; the owner gets relevance reminders instead (S3:
-- day 14, then every 30 days). Legacy FR-POST-012/013 300-day rule superseded.

create or replace function pg_temp.assert(p_cond boolean, p_msg text)
returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'ASSERT FAILED: %', p_msg; end if;
end $$;

-- T1: the 300-day expiry and its day-293 warning are gone.
do $$
begin
  perform pg_temp.assert(to_regprocedure('public.posts_expiry_transition()') is null,
    'posts_expiry_transition() still exists');
  perform pg_temp.assert(to_regprocedure('public.notifications_post_expiry_check()') is null,
    'notifications_post_expiry_check() still exists');
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform pg_temp.assert(
      not exists (select 1 from cron.job
                   where jobname in ('posts_expiry_daily', 'notifications_post_expiry_check')),
      'a posts expiry cron job is still scheduled');
  end if;
  raise notice '✓ T1 posts age-based expiry removed';
end $$;

-- T2: the remaining expiry sweeps (food listings, rides) leave a 400-day-old
-- open item post untouched.
begin;
do $$
declare
  v_owner uuid := gen_random_uuid();
  v_post uuid;
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, aud, role)
  values (v_owner, 'expiry_' || substr(v_owner::text, 1, 8) || '@test.local', now(),
          jsonb_build_object('full_name', 'Expiry Owner'), jsonb_build_object('provider', 'email'),
          'authenticated', 'authenticated');
  update public.users set account_status = 'active' where user_id = v_owner;

  insert into public.posts (post_id, owner_id, type, title, description, city, street, street_number, created_at)
  values (gen_random_uuid(), v_owner, 'Give', 'Old sofa', 'still available',
          (select city_id from public.cities limit 1), 'St', '1', now() - interval '400 days')
  returning post_id into v_post;

  perform public.food_expired_listings_sweep();
  perform public.ride_listings_expire_check();

  perform pg_temp.assert((select status from public.posts where post_id = v_post) = 'open',
    'an old item post was expired by an expiry sweep');
  raise notice '✓ T2 old item post stays open';
end $$;
rollback;

-- T3: reminder schedule (S3) — day 14, then every 30 days.
do $$
begin
  perform pg_temp.assert(
    (select array_agg(d order by d) from generate_series(0, 80) d where public.post_relevance_reminder_due(d))
      = array[14, 44, 74],
    'reminder days are not 14, 44, 74');
  raise notice '✓ T3 reminder schedule';
end $$;

-- T4: the daily job reminds the owner of a due open post once, and skips
-- posts that are not due or not open.
begin;
do $$
declare
  v_owner uuid := gen_random_uuid();
  v_due uuid; v_not_due uuid; v_closed uuid;
  v_city text := (select city_id from public.cities limit 1);
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, aud, role)
  values (v_owner, 'relevance_' || substr(v_owner::text, 1, 8) || '@test.local', now(),
          jsonb_build_object('full_name', 'Relevance Owner'), jsonb_build_object('provider', 'email'),
          'authenticated', 'authenticated');
  update public.users set account_status = 'active' where user_id = v_owner;

  insert into public.posts (post_id, owner_id, type, title, description, city, street, street_number, created_at)
  values (gen_random_uuid(), v_owner, 'Give', 'Due', 'd', v_city, 'St', '1', now() - interval '44 days')
  returning post_id into v_due;
  insert into public.posts (post_id, owner_id, type, title, description, city, street, street_number, created_at)
  values (gen_random_uuid(), v_owner, 'Request', 'Not due', 'd', v_city, 'St', '1', now() - interval '20 days')
  returning post_id into v_not_due;
  insert into public.posts (post_id, owner_id, type, title, description, city, street, street_number, created_at)
  values (gen_random_uuid(), v_owner, 'Give', 'Closed', 'd', v_city, 'St', '1', now() - interval '14 days')
  returning post_id into v_closed;
  update public.posts set status = 'deleted_no_recipient' where post_id = v_closed;

  perform public.notifications_post_relevance_check();
  perform public.notifications_post_relevance_check(); -- idempotent per day

  perform pg_temp.assert(
    (select count(*) from public.notifications_outbox
      where user_id = v_owner and kind = 'post_relevance_check') = 1,
    'expected exactly one relevance reminder for the due post');
  perform pg_temp.assert(
    exists (select 1 from public.notifications_outbox
             where user_id = v_owner and kind = 'post_relevance_check'
               and data -> 'params' ->> 'id' = v_due::text),
    'the reminder does not point at the due post');
  raise notice '✓ T4 reminder sent once, only for the due open post';
end $$;
rollback;

\echo '✓ 0450_posts_items_requests_never_expire.sql passed'
