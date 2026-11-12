-- Member realtime (0026): a counter change reaches only its owner's stats topic; a post
-- becoming open and Public pings feed:public once; online presence, globally and inside a
-- chat, needs an active member who shows their active status, in both directions.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Rows of realtime.messages a member may read or insert on a topic, as that member.
create function pg_temp.can(p_who text, p_topic text, p_extension text, p_insert boolean)
returns boolean
language plpgsql
as $$
declare
  v_ok boolean := true;
  v_rows bigint;
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', '00000000-0000-4000-8000-00000000000' || p_who, 'role', 'authenticated')::text, true);
  perform set_config('realtime.topic', p_topic, true);
  perform set_config('role', 'authenticated', true);
  if p_insert then
    begin
      insert into realtime.messages (topic, extension, payload) values (p_topic, p_extension, '{}');
    exception when insufficient_privilege then
      v_ok := false;
    end;
  else
    select count(*) into v_rows from realtime.messages m where m.topic = p_topic and m.extension = p_extension;
    v_ok := v_rows > 0;
  end if;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '{}', true);
  return v_ok;
end;
$$;

create function pg_temp.sent(p_topic text, p_event text)
returns bigint
language sql
as $$
  select count(*) from realtime.messages m where m.topic = p_topic and m.event = p_event;
$$;

select plan(14);

insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b', 'c']) x;
insert into public.cities (city_id, name_he, name_en, location) values ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)');
insert into public.worlds (slug, label_he, label_en) values ('items', 'items', 'items');
insert into public.post_kinds (id, world_slug, slug, label_he, label_en, direction)
values ('20000000-0000-4000-8000-000000000001', 'items', 'item', 'item', 'item', 'either');

-- Counters.
update public.user_stats set karma_points = 7 where user_id = '00000000-0000-4000-8000-00000000000a';
select is(pg_temp.sent('user:00000000-0000-4000-8000-00000000000a:stats', 'stats_changed'), 1::bigint,
  'a counter change is sent to the owner''s stats topic');
select is((select (payload ->> 'karma_points')::int from realtime.messages
            where topic = 'user:00000000-0000-4000-8000-00000000000a:stats'), 7,
  'the event carries the new karma total');
update public.user_stats set updated_at = now() where user_id = '00000000-0000-4000-8000-00000000000a';
select is(pg_temp.sent('user:00000000-0000-4000-8000-00000000000a:stats', 'stats_changed'), 1::bigint,
  'a write that changes no counter sends nothing');
select ok(pg_temp.can('a', 'user:00000000-0000-4000-8000-00000000000a:stats', 'broadcast', false)
          and not pg_temp.can('b', 'user:00000000-0000-4000-8000-00000000000a:stats', 'broadcast', false),
  'only the owner may listen to their stats topic');

-- Feed pill.
insert into public.posts (id, owner_id, world_slug, kind_id, direction, status, visibility, title, city_id)
values
  ('30000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'items',
   '20000000-0000-4000-8000-000000000001', 'offer', 'open', 'Public', 'public open', 'c1'),
  ('30000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-00000000000a', 'items',
   '20000000-0000-4000-8000-000000000001', 'offer', 'open', 'FollowersOnly', 'followers', 'c1'),
  ('30000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-00000000000a', 'items',
   '20000000-0000-4000-8000-000000000001', 'offer', 'draft', 'Public', 'draft', 'c1');
select is(pg_temp.sent('feed:public', 'new_post'), 1::bigint,
  'only the open Public post pings the feed; a followers-only post and a draft do not');
select is((select payload ->> 'post_id' from realtime.messages where topic = 'feed:public'),
  '30000000-0000-4000-8000-000000000001', 'the ping carries the post id and nothing of its content');
update public.posts set visibility = 'Public' where id = '30000000-0000-4000-8000-000000000002';
select is(pg_temp.sent('feed:public', 'new_post'), 2::bigint, 'widening an open post to Public pings once');
update public.posts set title = 'renamed' where id = '30000000-0000-4000-8000-000000000001';
select is(pg_temp.sent('feed:public', 'new_post'), 2::bigint, 'editing an already public post sends nothing');
select ok(pg_temp.can('b', 'feed:public', 'broadcast', false), 'any signed-in member may hear the feed ping');

-- Presence: Carol hides her active status.
update public.user_private set show_active_status = false where user_id = '00000000-0000-4000-8000-00000000000c';
select ok(pg_temp.can('a', 'presence:online', 'presence', true), 'a member who shows their status may track presence');
select ok(not pg_temp.can('c', 'presence:online', 'presence', true), 'a member who hides their status may not track');
select ok(pg_temp.can('b', 'presence:online', 'presence', false), 'a member who shows their status sees who is online');
select ok(not pg_temp.can('c', 'presence:online', 'presence', false),
  'a member who hides their status sees nobody online (reciprocal)');
update public.users set is_active = false where id = '00000000-0000-4000-8000-00000000000b';
select ok(not pg_temp.can('b', 'presence:online', 'presence', true), 'an inactive account may not track presence');

select * from finish();
rollback;
