-- supabase/tests/0716_giving_reservation_expiry.sql
-- Wave 2c (#1989): an item request the giver does not answer within its confirm window lapses.
-- The sweep cancels it as expired, frees the post for a new request, and pushes both sides
-- `giving_handoff_expired`; a request still in its window and an approved one are untouched.
-- Runs in a rolled-back transaction.

begin;

create temp table personas as
select kc_test.create_user('w2c_giver')   as giver,
       kc_test.create_user('w2c_asker')   as asker,
       kc_test.create_user('w2c_second')  as second_asker;

create function pg_temp.item_listing(p_owner uuid, p_title text)
returns uuid
language sql
as $$
  select kc_test.create_listing(p_owner, 'items', 'give_item', 'give', p_title,
                                '{"item_condition":"Good"}'::jsonb);
$$;
grant execute on function pg_temp.item_listing(uuid, text) to public;

do $$
declare
  p personas;
  v_stale_listing uuid;
  v_fresh_listing uuid;
  v_stale uuid;
  v_fresh uuid;
  v_post uuid;
begin
  select * into p from personas;
  v_stale_listing := pg_temp.item_listing(p.giver, 'w2c stale lamp');
  v_fresh_listing := pg_temp.item_listing(p.giver, 'w2c fresh lamp');

  perform kc_test.act_as(p.asker);
  v_stale := (public.reserve_item_giving(v_stale_listing)).handoff_id;
  v_fresh := (public.reserve_item_giving(v_fresh_listing)).handoff_id;
  select post_id into v_post from public.post_handoffs where handoff_id = v_stale;

  -- The stale request's window ended an hour ago; the fresh one is still open.
  update public.post_handoffs set confirm_by = now() - interval '1 hour' where handoff_id = v_stale;

  -- The sweep runs from pg_cron with no signed-in member, so nobody is the acting side.
  perform kc_test.act_as_anon();

  perform kc_test.assert_eq(public.giving_reservation_expiry_sweep(), 1, 'one request lapsed');
  perform kc_test.assert_eq(
    (select status || '/' || cancel_reason from public.post_handoffs where handoff_id = v_stale),
    'cancelled/expired', 'the unanswered request is cancelled as expired');
  perform kc_test.assert_eq(
    (select status from public.post_handoffs where handoff_id = v_fresh), 'reserved',
    'a request inside its window is untouched');
  perform kc_test.assert_eq(
    (select availability_status from public.posts where post_id = v_post), 'immediate',
    'the post is available again');

  perform kc_test.assert_eq(
    (select count(*) from public.notifications_outbox
      where kind = 'giving_handoff_expired'
        and dedupe_key like 'giving_handoff_expired:' || v_stale::text || ':%'
        and user_id in (p.giver, p.asker)),
    2::bigint, 'both sides are told the request expired');

  -- Someone else can now ask for the item.
  perform kc_test.act_as(p.second_asker);
  perform kc_test.assert_true(
    (public.reserve_item_giving(v_stale_listing)).handoff_id is not null, 'the item can be requested again');

  -- An approved handoff is never swept, whatever its old confirm window.
  perform kc_test.act_as(p.giver);
  perform public.confirm_item_handoff(v_fresh);
  update public.post_handoffs set confirm_by = now() - interval '1 hour' where handoff_id = v_fresh;
  perform kc_test.act_as_anon();
  perform kc_test.assert_eq(public.giving_reservation_expiry_sweep(), 0, 'nothing else lapses');
  perform kc_test.assert_eq(
    (select status from public.post_handoffs where handoff_id = v_fresh), 'confirmed',
    'an approved handoff stays confirmed');
end $$;

do $$
begin
  perform kc_test.assert_true(
    not has_function_privilege('authenticated', 'public.giving_reservation_expiry_sweep()', 'EXECUTE'),
    'clients cannot run the sweep');
end $$;

rollback;

\echo '✓ 0716_giving_reservation_expiry.sql passed'
