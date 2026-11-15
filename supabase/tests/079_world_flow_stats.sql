-- Platform flow funnel (FR-STATS-007) and a member's givings by world (FR-STATS-008): the
-- funnel follows the posts published in the window through their handoffs, per world and
-- direction, for moderators and above; the givings are the caller's own only.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Runs a statement as a member (anon when null); its one value as text, or the error message.
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
    return coalesce(v_value, 'empty');
  exception when others then
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '{}', true);
    return case when sqlstate in ('P0001', '42501') then sqlerrm else sqlstate end;
  end;
end;
$$;

create function pg_temp.post(p_n integer)
returns uuid
language sql
immutable
as $$
  select ('10000000-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'))::uuid;
$$;

select plan(8);

-- a, b, c are members; m moderates (digit e), s is support (digit f).
insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b', 'c', 'e', 'f']) x;
insert into public.admin_role_grants (user_id, role) values
  ('00000000-0000-4000-8000-00000000000e', 'moderator'),
  ('00000000-0000-4000-8000-00000000000f', 'support');
insert into public.cities (city_id, name_he, name_en, location) values ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)');
insert into public.worlds (slug, label_he, label_en) values ('items', 'i', 'Items'), ('money', 'm', 'Money');
insert into public.post_kinds (id, world_slug, slug, label_he, label_en, direction) values
  ('20000000-0000-4000-8000-000000000001', 'items', 'item', 'item', 'item', 'either'),
  ('20000000-0000-4000-8000-000000000002', 'money', 'gift', 'gift', 'gift', 'either');
-- Alice offers items 1–4, asks for item 5 and posts money post 6; post 7 is two months old.
insert into public.posts (id, owner_id, world_slug, kind_id, direction, status, title, city_id)
select pg_temp.post(n), '00000000-0000-4000-8000-00000000000a', w,
       ('20000000-0000-4000-8000-00000000000' || case w when 'items' then '1' else '2' end)::uuid,
       d, 'open', 'post ' || n, 'c1'
  from (values (1, 'items', 'offer'), (2, 'items', 'offer'), (3, 'items', 'offer'), (4, 'items', 'offer'),
               (5, 'items', 'request'), (6, 'money', 'offer'), (7, 'items', 'offer')) v (n, w, d);
update public.posts set published_at = now() - interval '10 hours' where world_slug = 'items';
update public.posts set published_at = now() - interval '60 days' where id = pg_temp.post(7);

-- Bob reserves post 1, which Alice hands over; Carol reserves post 2 and cancels; Bob
-- reserves post 3, confirmed; Alice closes post 4 without a recipient; post 7 is handed to Carol.
insert into public.post_handoffs (post_id, recipient_id) values
  (pg_temp.post(1), '00000000-0000-4000-8000-00000000000b'),
  (pg_temp.post(2), '00000000-0000-4000-8000-00000000000c'),
  (pg_temp.post(3), '00000000-0000-4000-8000-00000000000b'),
  (pg_temp.post(7), '00000000-0000-4000-8000-00000000000c');
update public.post_handoffs set created_at = now() - interval '6 hours' where post_id <> pg_temp.post(7);
select set_config('kc.fsm_role', 'owner', true);
-- The machine stamps handed_over_at with the time of the move (now).
update public.post_handoffs set status = 'handed_over'
 where post_id in (pg_temp.post(1), pg_temp.post(7));
update public.post_handoffs set status = 'cancelled', cancel_reason = 'owner_cancelled', cancelled_at = now()
 where post_id = pg_temp.post(2);
update public.post_handoffs set status = 'confirmed', confirmed_at = now() where post_id = pg_temp.post(3);
-- the posts close as their owner
update public.posts set status = 'closed_delivered' where id in (pg_temp.post(1), pg_temp.post(7));
update public.posts set status = 'deleted_no_recipient' where id = pg_temp.post(4);
select set_config('kc.fsm_role', '', true);

select is(pg_temp.as_member('e', $$select string_agg(concat_ws('|', world_slug, direction, published,
      coalesce(booked::text, '-'), coalesce(confirmed::text, '-'), coalesce(completed::text, '-'),
      coalesce(cancelled::text, '-'), closed, coalesce(median_hours_to_booking::text, '-'),
      coalesce(median_hours_to_completion::text, '-')), ' ; ')
    from public.admin_world_flow_funnel(30)$$),
  'items|give|4|3|2|1|1|2|4.0|10.0 ; items|request|1|0|0|0|0|0|-|- ; money|give|1|-|-|-|-|0|-|-',
  'a moderator reads the funnel of each world and direction; money has no handoff stages');
select is(pg_temp.as_member('e', $$select sum(published)::text from public.admin_world_flow_funnel(90)$$), '7',
  'a longer window takes in older posts');
select is(pg_temp.as_member('f', $$select count(*) from public.admin_world_flow_funnel()$$), 'forbidden',
  'support staff cannot read the funnel');
select is(pg_temp.as_member('a', $$select count(*) from public.admin_world_flow_funnel()$$), 'forbidden',
  'a member cannot read it');

select is(pg_temp.as_member('a', $$select string_agg(concat_ws('|', world_slug, given, received, closed), ' ; ')
    from public.my_world_givings()$$), 'items|2|0|3', 'the owner sees what they gave and closed');
select is(pg_temp.as_member('c', $$select string_agg(concat_ws('|', world_slug, given, received, closed), ' ; ')
    from public.my_world_givings()$$), 'items|0|1|0', 'a recipient sees what they received');
select is(pg_temp.as_member('e', $$select count(*) from public.my_world_givings()$$), '0',
  'a member with no activity sees nothing, and never anyone else''s');
select is(pg_temp.as_member(null, $$select count(*) from public.my_world_givings()$$),
  'permission denied for function my_world_givings', 'a signed-out caller cannot call it');

select * from finish();
rollback;
