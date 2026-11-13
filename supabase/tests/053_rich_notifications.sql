-- Rich notifications (0027, D26): follow kinds are pushed again; a notification about a post
-- carries its title, and a booking its seats, time and a ride's route; a knowledge booking
-- and a food expiry have their own kinds; a chat hidden after reports tells its members.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

create function pg_temp.told(p_kind text, p_who text)
returns bigint
language sql
as $$
  select count(*) from kc_private.outbox_events e
   where e.topic = 'notification' and e.payload ->> 'kind' = p_kind
     and e.payload ->> 'recipient_id' = '00000000-0000-4000-8000-00000000000' || p_who;
$$;

select plan(11);

insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b']) x;
insert into public.cities (city_id, name_he, name_en, location) values
  ('c1', 'Haifa', 'Haifa', 'SRID=4326;POINT(34.99 32.79)'),
  ('c2', 'Tel Aviv', 'Tel Aviv', 'SRID=4326;POINT(34.78 32.08)');
insert into public.worlds (slug, label_he, label_en) values ('rides', 'rides', 'rides'), ('items', 'items', 'items');
insert into public.post_kinds (id, world_slug, slug, label_he, label_en, direction) values
  ('20000000-0000-4000-8000-000000000001', 'rides', 'ride_request', 'r', 'r', 'request'),
  ('20000000-0000-4000-8000-000000000002', 'items', 'item', 'i', 'i', 'either');

-- ── Follow pushes ───────────────────────────────────────────────────────────
select is((select string_agg(kind || ':' || sends_push, ',' order by kind) from kc_private.notification_kinds
            where kind like 'follow_%'),
  'follow_approved:true,follow_request:true,follow_started:true',
  'follow requests, new followers and approvals are pushed (FR-NOTIF-006..008)');
select is((select category from kc_private.notification_kinds where kind = 'follow_started'), 'social',
  'they stay in the social group, which the member can switch off as a whole');

-- ── Rich arguments ──────────────────────────────────────────────────────────
insert into public.posts (id, owner_id, world_slug, kind_id, post_type, direction, status, title, city_id) values
  ('30000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'rides',
   '20000000-0000-4000-8000-000000000001', 'ride', 'request', 'open', 'To the beach', 'c1'),
  ('30000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-00000000000a', 'items',
   '20000000-0000-4000-8000-000000000002', 'standard', 'offer', 'open', 'Blue chair', 'c1');
insert into public.post_ride_details (post_id, origin_city_id, origin_point, dest_city_id, dest_point, departs_at, seats)
values ('30000000-0000-4000-8000-000000000001', 'c1', 'SRID=4326;POINT(34.99 32.79)', 'c2', 'SRID=4326;POINT(34.78 32.08)',
        '2026-12-01 06:30:00+00', 3);

select is(kc_private.notification_rich_args('post', '30000000-0000-4000-8000-000000000001', '{}'),
  '{"post_title": "To the beach", "route_from": "Haifa", "route_to": "Tel Aviv", "when_label": "01.12 08:30"}'::jsonb,
  'a ride names its title, its route and its departure in Israel time');
select is(kc_private.notification_rich_args(null, null, '{"post_id": "30000000-0000-4000-8000-000000000002"}'),
  '{"post_title": "Blue chair"}'::jsonb, 'a post named only in the arguments is found as well');
select is(kc_private.notification_rich_args('user', '00000000-0000-4000-8000-00000000000a', '{"post_id": "not-a-uuid"}'),
  '{}'::jsonb, 'nothing is added when there is no post');

insert into public.notifications (user_id, kind, category, entity_type, entity_id, title_key, body_key, data)
values ('00000000-0000-4000-8000-00000000000a', 'post_expired', 'critical', 'post',
        '30000000-0000-4000-8000-000000000002', 'notifications.postExpiredTitle', 'notifications.postExpiredBody',
        '{"world_slug": "items"}');
select is((select data from public.notifications where entity_id = '30000000-0000-4000-8000-000000000002'),
  '{"world_slug": "items", "post_title": "Blue chair"}'::jsonb,
  'a written notification carries the post title next to the emitter''s arguments');
update public.notifications set data = '{"post_title": "kept"}' where entity_id = '30000000-0000-4000-8000-000000000002';
select is((select data ->> 'post_title' from public.notifications where entity_id = '30000000-0000-4000-8000-000000000002'),
  'kept', 'an argument the emitter set is not overwritten');

-- ── Kinds of their own ──────────────────────────────────────────────────────
select is((select count(*)::int from kc_private.notification_kinds where kind like 'knowledge_booking_%'), 10,
  'every knowledge booking change has its own kind');
select is((select string_agg(kind, ',' order by kind) from kc_private.notification_kinds
            where kind in ('food_expiring', 'food_expired', 'chat_auto_removed')),
  'chat_auto_removed,food_expired,food_expiring', 'food expiry and the chat removal notice are registered');

-- ── A chat hidden after reports ─────────────────────────────────────────────
insert into public.chats (id, kind, direct_user_a, direct_user_b) values
  ('40000000-0000-4000-8000-000000000001', 'direct', '00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b');
insert into public.chat_members (chat_id, user_id)
select '40000000-0000-4000-8000-000000000001', ('00000000-0000-4000-8000-00000000000' || x)::uuid from unnest(array['a', 'b']) x;
update public.chats set moderation_hidden_at = now();
select is(pg_temp.told('chat_auto_removed', 'a') || '|' || pg_temp.told('chat_auto_removed', 'b'), '1|1',
  'each member of a chat hidden for review is told once');
update public.chats set moderation_hidden_at = null;
update public.chats set moderation_hidden_at = moderation_hidden_at;
select is(pg_temp.told('chat_auto_removed', 'a'), 1::bigint, 'restoring the chat tells nobody');

select * from finish();
rollback;
