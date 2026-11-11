-- M10: the feed on a map. Pins and clusters come from the approximate point only, respect the
-- reader's access (audience, blocks, status), take the feed's filters, and are bounded.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

create function pg_temp.expand(p_sql text)
returns text language sql as $$
  select regexp_replace(p_sql, '@([a-e])', '''00000000-0000-4000-8000-00000000000\1''::uuid', 'g');
$$;

-- One value of a query run as a member (null = signed out); an error returns its SQLSTATE
-- or P0001 message.
create function pg_temp.q(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_value text;
  v_sql constant text := pg_temp.expand(p_sql);
begin
  perform set_config('request.jwt.claims', case when p_who is null then '{"role":"anon"}'
    else jsonb_build_object('sub', '00000000-0000-4000-8000-00000000000' || p_who, 'role', 'authenticated')::text end, true);
  perform set_config('role', case when p_who is null then 'anon' else 'authenticated' end, true);
  execute v_sql into v_value;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '{}', true);
  return coalesce(v_value, '~');
exception when others then
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '{}', true);
  return case sqlstate when 'P0001' then sqlerrm else sqlstate end;
end;
$$;

select plan(24);

-- a owns the posts · b is a reader · c is blocked by a · d follows a.
insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b', 'c', 'd']) x;
insert into public.blocks (blocker_id, blocked_id) values
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000c');
insert into public.follows (follower_id, followed_id) values
  ('00000000-0000-4000-8000-00000000000d', '00000000-0000-4000-8000-00000000000a');
insert into public.cities (city_id, name_he, name_en, location) values
  ('c1', 'c1', 'Coast', 'SRID=4326;POINT(34.78 32.08)'),
  ('c2', 'c2', 'Hills', 'SRID=4326;POINT(35.21 31.77)'),
  ('c3', 'c3', 'North', 'SRID=4326;POINT(34.99 32.79)');
insert into public.worlds (slug, label_he, label_en) values ('items', 'items', 'items'), ('food', 'food', 'food');
insert into public.post_kinds (id, world_slug, slug, label_he, label_en, direction) values
  ('20000000-0000-4000-8000-000000000001', 'items', 'items_kind', 'items', 'items', 'either'),
  ('20000000-0000-4000-8000-000000000002', 'food', 'food_kind', 'food', 'food', 'either');
-- 01-03 public in c1 (03 is a request) · 04 followers-only in c1 · 05 public food in c2 · 06 public in c3
-- · 07 public in c1, to be closed · 08 draft in c1.
insert into public.posts (id, owner_id, world_slug, kind_id, post_type, direction, status, visibility, title, city_id)
select ('10000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       '00000000-0000-4000-8000-00000000000a', w,
       (select k.id from public.post_kinds k where k.world_slug = w), 'standard', d,
       case when n = 8 then 'draft' else 'open' end, v, 'post ' || n, c
  from (values
    (1, 'items', 'offer', 'Public', 'c1'), (2, 'items', 'offer', 'Public', 'c1'), (3, 'items', 'request', 'Public', 'c1'),
    (4, 'items', 'offer', 'FollowersOnly', 'c1'), (5, 'food', 'offer', 'Public', 'c2'),
    (6, 'items', 'offer', 'Public', 'c3'), (7, 'items', 'offer', 'Public', 'c1'), (8, 'items', 'offer', 'Public', 'c1')
  ) as p (n, w, d, v, c);
select kc_private.post_move('10000000-0000-4000-8000-000000000007', 'closed_delivered', 'owner');

-- West-east-south-north of the coast city only, and of the whole country.
select is(pg_temp.q('b', $$select public.map_post_pins('{"west":34.7,"south":32.0,"east":34.9,"north":32.2}')::text$$) is not null, true, 'pins can be asked for');
select is(pg_temp.q(null, $$select count(*)::text from public.map_post_pins('{"west":34.7,"south":32.0,"east":34.9,"north":32.2}')$$), '42501', 'a signed-out caller has no map');
select is(pg_temp.q('b', $$select count(*)::text from public.map_post_pins('{"west":34.9,"south":32.0,"east":34.7,"north":32.2}')$$), 'invalid_bounds', 'bounds must run west to east');
select is(pg_temp.q('b', $$select count(*)::text from public.map_post_pins('{"west":34.7,"south":32.0}')$$), 'invalid_bounds', 'and be complete');
select is(pg_temp.q('b', $$select count(*)::text from public.map_post_pins('{"west":34.7,"south":32.0,"east":34.9,"north":32.2}', '{"direction":"swap"}')$$), 'invalid_input', 'a direction is offer or request');
select is(pg_temp.q('b', $$select count(*)::text from public.map_post_pins('{"west":34.7,"south":32.0,"east":34.9,"north":32.2}')$$), '3',
  'a reader sees the public open posts of the viewport, not a followers-only, closed or draft one');
select is(pg_temp.q('d', $$select count(*)::text from public.map_post_pins('{"west":34.7,"south":32.0,"east":34.9,"north":32.2}')$$), '4', 'a follower also sees the followers-only post');
select is(pg_temp.q('a', $$select count(*)::text from public.map_post_pins('{"west":34.7,"south":32.0,"east":34.9,"north":32.2}')$$), '4', 'an owner sees their own');
select is(pg_temp.q('c', $$select count(*)::text from public.map_post_pins('{"west":34.7,"south":32.0,"east":34.9,"north":32.2}')$$), '0', 'a blocked member sees none of the blocker''s posts');
select is(pg_temp.q('b', $$select count(*)::text from public.map_post_pins('{"west":34,"south":31,"east":36,"north":33}')$$), '5', 'a country-wide viewport adds the other cities');
select is(pg_temp.q('b', $$select count(*)::text from public.map_post_pins('{"west":35.0,"south":31.5,"east":35.5,"north":32.0}')$$), '1', 'and a viewport away from the coast only its own post');
select is(pg_temp.q('b', $$select count(*)::text from public.map_post_pins('{"west":34,"south":31,"east":36,"north":33}', '{"world":"food"}')$$), '1', 'the world filter applies');
select is(pg_temp.q('b', $$select count(*)::text from public.map_post_pins('{"west":34,"south":31,"east":36,"north":33}', '{"direction":"request"}')$$), '1', 'so does the direction filter');
select is(pg_temp.q('b', $$select count(*)::text from public.map_post_pins('{"west":34,"south":31,"east":36,"north":33}', '{}', 2)$$), '2', 'the limit bounds the answer');
select is(pg_temp.q('b', $$select lat || '/' || lng from public.map_post_pins('{"west":35.0,"south":31.5,"east":35.5,"north":32.0}')$$), '31.77/35.21',
  'a pin is the approximate point, here the city centre');

-- An exact address is never the pin: the point is coarsened to about 300 m.
insert into public.post_private_locations (post_id, exact_point, street, street_number)
values ('10000000-0000-4000-8000-000000000001', 'SRID=4326;POINT(34.7813 32.0851)', 'Herzl', '7');
update public.posts set location_display_level = 'FullAddress' where id = '10000000-0000-4000-8000-000000000001';
select is(pg_temp.q('b', $$select (lat <> 32.0851 and lng <> 34.7813 and abs(lat - 32.0851) < 0.004 and abs(lng - 34.7813) < 0.004)::text
    from public.map_post_pins('{"west":34.7,"south":32.0,"east":34.9,"north":32.2}') where post_id = '10000000-0000-4000-8000-000000000001'$$),
  'true', 'with a full address the pin is a coarsened point near it, not the address');

-- Clusters.
select is(pg_temp.q('b', $$select sum(post_count)::text from public.map_post_clusters('{"west":34,"south":31,"east":36,"north":33}', 3)$$), '5', 'clusters account for every readable post');
select is(pg_temp.q('b', $$select count(*)::text from public.map_post_clusters('{"west":34,"south":31,"east":36,"north":33}', 3)$$), '1', 'at a low zoom the country is one cell');
select is(pg_temp.q('b', $$select count(*)::text from public.map_post_clusters('{"west":34,"south":31,"east":36,"north":33}', 12)$$), '3', 'at a high zoom the three cities separate');
select is(pg_temp.q('b', $$select post_count || '/' || coalesce(single_post_id::text, '~') from public.map_post_clusters('{"west":34,"south":31,"east":36,"north":33}', 12) order by post_count desc limit 1$$),
  '3/~', 'the largest cluster is the coast with its three posts and no single id');
select is(pg_temp.q('b', $$select single_post_id::text from public.map_post_clusters('{"west":35.0,"south":31.5,"east":35.5,"north":32.0}', 12)$$), '10000000-0000-4000-8000-000000000005', 'a lone post names itself');
select is(pg_temp.q('d', $$select sum(post_count)::text from public.map_post_clusters('{"west":34,"south":31,"east":36,"north":33}', 3)$$), '6',
  'the counts follow the reader''s access: a follower counts one more');
select is(pg_temp.q('b', $$select count(*)::text from public.map_post_clusters('{"west":34,"south":31,"east":36,"north":33}', 25)$$), 'invalid_input', 'the zoom is 0 to 20');
select is(pg_temp.q('b', $$select count(*)::text from public.map_post_clusters('{"west":34,"south":31,"east":36}', 5)$$), 'invalid_bounds', 'clusters check the bounds too');

select * from finish();
rollback;
