-- supabase/tests/0391_rides_knowledge_flows.sql | 0390–0399 behaviour:
-- knowledge: slot booking, complete, rating. The rides lifecycle (corridor match, seat
-- booking, confirm, trip complete, karma, rating) lives in flows/rides_lifecycle.sql.

begin;

create or replace function pg_temp.mk_user(p_id uuid, p_handle text)
returns void language plpgsql as $$
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, aud, role)
  values (p_id, p_handle || '@test.local', now(),
          jsonb_build_object('full_name', 'Display ' || p_handle),
          jsonb_build_object('provider', 'email'),
          'authenticated', 'authenticated');
  update public.users
     set share_handle = p_handle, display_name = 'Display ' || p_handle,
         account_status = 'active', privacy_mode = 'Public'
   where user_id = p_id;
end $$;

create or replace function pg_temp.as_user(p_id uuid)
returns void language sql as $$
  select set_config('request.jwt.claims',
    jsonb_build_object('sub', p_id, 'role', 'authenticated')::text, true);
$$;

select pg_temp.mk_user('00000000-0000-0000-0000-000000391001', 'rk_driver');
select pg_temp.mk_user('00000000-0000-0000-0000-000000391002', 'rk_pass1');
select pg_temp.mk_user('00000000-0000-0000-0000-000000391003', 'rk_pass2');

-- Knowledge: one-slot private lesson starting in 10 minutes.
-- Publishing in knowledge requires a verified member (0264 has_world_permission).
update public.users set verified_at = now() where user_id = '00000000-0000-0000-0000-000000391001';
select pg_temp.as_user('00000000-0000-0000-0000-000000391001');
insert into public.listings (
  listing_id, owner_id, world_slug, kind_id, direction, title, origin, moderation_status, details
)
select '00000000-0000-0000-0000-0000003910b1', '00000000-0000-0000-0000-000000391001',
       'knowledge', kind_id, 'give', 'Intro to Python', 'native', 'published',
       jsonb_build_object(
         'topic', 'Python', 'modality', 'video', 'slots_available', 1,
         'slot_starts_at', to_char((now() + interval '10 minutes') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
         'slot_ends_at', to_char((now() + interval '70 minutes') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
  from public.listing_kinds where world_slug = 'knowledge' and slug = 'private_lesson';
-- Knowledge listings start in pending_review (0266); simulate moderator approval.
update public.listings set moderation_status = 'published'
 where listing_id = '00000000-0000-0000-0000-0000003910b1';

do $$
declare
  v_h public.giving_handoffs;
begin
  perform pg_temp.as_user('00000000-0000-0000-0000-000000391002');
  v_h := public.book_knowledge_slot('00000000-0000-0000-0000-0000003910b1');
  if v_h.status <> 'reserved' or v_h.slot_starts_at is null then
    raise exception 'ASSERT FAILED: knowledge booking should be reserved with slot time';
  end if;

  perform pg_temp.as_user('00000000-0000-0000-0000-000000391003');
  begin
    perform public.book_knowledge_slot('00000000-0000-0000-0000-0000003910b1');
    raise exception 'ASSERT FAILED: second booking on 1 slot should fail';
  exception when raise_exception then
    if sqlerrm <> 'slots_exhausted' then raise exception 'ASSERT FAILED: expected slots_exhausted, got %', sqlerrm; end if;
  end;

  perform pg_temp.as_user('00000000-0000-0000-0000-000000391001');
  v_h := public.complete_knowledge_session(v_h.handoff_id);
  if v_h.status <> 'handed_over' then raise exception 'ASSERT FAILED: session should be handed_over'; end if;

  perform pg_temp.as_user('00000000-0000-0000-0000-000000391002');
  perform public.rate_giving_handoff(v_h.handoff_id, 4::smallint, null);
end $$;

rollback;

\echo '✓ 0391_rides_knowledge_flows.sql passed'
