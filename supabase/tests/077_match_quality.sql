-- Match quality report (admin_match_quality, FR-ADMIN-029): per giving world, the pairs
-- alerted in the window, the answers and acceptances, the pairs that talked after the
-- alert and the pairs that completed a handoff; moderators and above only.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Runs a statement as a member (anon when null) and returns its one value as text, the
-- P0001 or 42501 message, or the SQLSTATE.
create function pg_temp.as_member(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  begin
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', '00000000-0000-4000-8000-00000000000' || p_who,
      'role', case when p_who is null then 'anon' else 'authenticated' end)::text, true);
    perform set_config('role', case when p_who is null then 'anon' else 'authenticated' end, true);
    execute p_sql into v_value;
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '{}', true);
    return coalesce(v_value, 'ok');
  exception when others then
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '{}', true);
    return case when sqlstate in ('P0001', '42501') then sqlerrm else sqlstate end;
  end;
end;
$$;

-- The report as a member, one line per world.
create function pg_temp.report(p_who text, p_days integer default 30)
returns text
language sql
as $$
  select pg_temp.as_member(p_who, format($q$select coalesce(string_agg(concat_ws('|', world_slug, world_label_en,
      notified_pairs, responses, accepted, coalesce(precision_proxy::text, '-'), chat_pairs, chat_rate,
      completed_pairs, completion_rate), ' ; '), 'empty') from public.admin_match_quality(%s)$q$, p_days));
$$;

-- The id of test post number p_n.
create function pg_temp.post_id(p_n integer)
returns uuid
language sql
immutable
as $$
  select ('10000000-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'))::uuid;
$$;

select plan(7);

-- Alice offers; Bob, Carol and Dan ask. Eve moderates, Fay answers support.
insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b', 'c', 'd', 'e', 'f']) x;
insert into public.admin_role_grants (user_id, role) values
  ('00000000-0000-4000-8000-00000000000e', 'moderator'),
  ('00000000-0000-4000-8000-00000000000f', 'support');
insert into public.cities (city_id, name_he, name_en, location) values ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)');
insert into public.worlds (slug, label_he, label_en) values ('items', 'i', 'Items'), ('food', 'f', 'Food');
insert into public.post_kinds (id, world_slug, slug, label_he, label_en, direction) values
  ('20000000-0000-4000-8000-000000000001', 'items', 'item', 'item', 'item', 'either'),
  ('20000000-0000-4000-8000-000000000002', 'food', 'dish', 'dish', 'dish', 'either');
insert into public.posts (id, owner_id, world_slug, kind_id, direction, status, title, city_id)
select pg_temp.post_id(n), ('00000000-0000-4000-8000-00000000000' || o)::uuid, w,
       ('20000000-0000-4000-8000-00000000000' || case w when 'items' then '1' else '2' end)::uuid,
       d, 'open', 'post ' || n, 'c1'
  from (values
    (1, 'a', 'items', 'offer'), (2, 'b', 'items', 'request'),
    (3, 'a', 'items', 'offer'), (4, 'c', 'items', 'request'),
    (5, 'a', 'items', 'offer'), (6, 'd', 'items', 'request'),
    (7, 'a', 'items', 'offer'), (8, 'c', 'items', 'request'),
    (9, 'a', 'food', 'offer'), (10, 'c', 'food', 'request')
  ) as p (n, o, w, d);

-- Pair 1-2 told two days ago, both said yes; 3-4 told yesterday, the offer declined;
-- 5-6 told forty days ago; 7-8 never told; the food pair 9-10 told yesterday, unanswered.
insert into kc_private.match_candidates (
  offer_post_id, request_post_id, offer_owner_id, request_owner_id, world_slug, score,
  offer_response, request_response, notified_offer_at, notified_request_at)
select pg_temp.post_id(o), pg_temp.post_id(r), p1.owner_id, p2.owner_id, p1.world_slug, 0.8,
       ores, rres, now() - oago, now() - rago
  from (values
    (1, 2, 'accepted', 'accepted', interval '2 days', interval '3 days'),
    (3, 4, 'declined', null, interval '20 hours', null),
    (5, 6, 'accepted', null, interval '40 days', interval '40 days'),
    (7, 8, null, null, null, null),
    (9, 10, null, null, interval '20 hours', interval '20 hours')
  ) as m (o, r, ores, rres, oago, rago)
  join public.posts p1 on p1.id = pg_temp.post_id(m.o)
  join public.posts p2 on p2.id = pg_temp.post_id(m.r);

-- Alice and Bob talk about pair 1-2 and Alice hands the item over to Bob.
select is(pg_temp.as_member('a', $$select 'ok' from public.send_message(
      (public.open_direct_chat('00000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-000000000001')).id, 'still there?')$$)
    || pg_temp.as_member('a', $$select 'ok' from public.close_post_with_recipient(
      '10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000b')$$),
  'okok', 'the owners of one pair talk and complete the handoff');

select is(pg_temp.report('e'),
  'items|Items|2|3|2|0.6667|1|0.5000|1|0.5000 ; food|Food|1|0|0|-|0|0.0000|0|0.0000',
  'a moderator reads the quality of each world over the last 30 days, busiest first');
select is(pg_temp.report('e', 60),
  'items|Items|3|4|3|0.7500|1|0.3333|1|0.3333 ; food|Food|1|0|0|-|0|0.0000|0|0.0000',
  'a longer window takes in older alerts; a pair never told is never counted');
select is(pg_temp.report('e', 0) || ' / ' || pg_temp.report('e', 100000), 'food|Food|1|0|0|-|0|0.0000|0|0.0000'
    || ' ; items|Items|1|1|0|0.0000|0|0.0000|0|0.0000 / '
    || 'items|Items|3|4|3|0.7500|1|0.3333|1|0.3333 ; food|Food|1|0|0|-|0|0.0000|0|0.0000',
  'the window is clamped to between one day and a year');
select is(pg_temp.report('a'), 'forbidden', 'a member, even one who owns the pairs, cannot read the report');
select is(pg_temp.report('f'), 'forbidden', 'support staff cannot read it either');
select is(pg_temp.report(null), 'permission denied for function admin_match_quality', 'a signed-out caller cannot call it');

select * from finish();
rollback;
