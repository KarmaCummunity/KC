-- Activity and community numbers: active days are recorded once a day and never readable;
-- the timeline is the caller's own; community numbers are counts from one stored row.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- `@x` is a member, `#NN` a post of the fixture.
create function pg_temp.sql(p_sql text)
returns text
language sql
as $$
  select regexp_replace(regexp_replace(p_sql, '@([a-e])', '''00000000-0000-4000-8000-00000000000\1''::uuid', 'g'),
                        '#(\d\d)', '''10000000-0000-4000-8000-0000000000\1''::uuid', 'g');
$$;
-- Runs a statement as a member (anon when null, the service role for `s`): 'ok', a P0001
-- message, or the SQLSTATE.
create function pg_temp.act(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_role constant text := case when p_who is null then 'anon' when p_who = 's' then 'service_role'
                               else 'authenticated' end;
  v_sql constant text := pg_temp.sql(p_sql);
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', '00000000-0000-4000-8000-00000000000' || p_who, 'role', v_role)::text, true);
  perform set_config('role', v_role, true);
  execute v_sql;
  perform set_config('role', 'none', true);
  return 'ok';
exception when others then
  perform set_config('role', 'none', true);
  return case sqlstate when 'P0001' then sqlerrm else sqlstate end;
end;
$$;
-- One value a member reads with a query.
create function pg_temp.get(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_sql constant text := pg_temp.sql(p_sql);
  v_value text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', '00000000-0000-4000-8000-00000000000' || p_who, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute v_sql into v_value;
  perform set_config('role', 'none', true);
  return v_value;
end;
$$;

select plan(16);

insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b', 'c', 'd']) x;
insert into public.cities (city_id, name_he, name_en, location) values ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)');
insert into public.worlds (slug, label_he, label_en) values ('items', 'items', 'items');
insert into public.post_kinds (id, world_slug, slug, label_he, label_en, direction)
values ('20000000-0000-4000-8000-000000000001', 'items', 'item', 'item', 'item', 'either');
insert into public.posts (id, owner_id, world_slug, kind_id, direction, status, visibility, title, city_id) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'items',
   '20000000-0000-4000-8000-000000000001', 'offer', 'open', 'Public', 'a chair', 'c1'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-00000000000a', 'items',
   '20000000-0000-4000-8000-000000000001', 'offer', 'open', 'OnlyMe', 'a secret', 'c1');

-- ── Active days ──────────────────────────────────────────────────────────────
select is(pg_temp.act('a', 'select public.record_active_day()') || '/' || pg_temp.act('a', 'select public.record_active_day()'),
  'ok/ok', 'a member marks today, as often as the app comes to the foreground');
select is((select count(*) from kc_private.user_active_days), 1::bigint, 'one row per member per day');
select is(pg_temp.act(null, 'select public.record_active_day()'), '42501', 'a signed-out caller marks nothing');
select is(pg_temp.act('a', 'select 1 from kc_private.user_active_days'), '42501', 'active days are not readable from a device');
insert into kc_private.user_active_days (user_id, active_on) values
  ('00000000-0000-4000-8000-00000000000a', current_date - 5), ('00000000-0000-4000-8000-00000000000a', current_date - 30),
  ('00000000-0000-4000-8000-00000000000a', current_date - 500);
select is(kc_private.user_active_days_14d('00000000-0000-4000-8000-00000000000a'), 2, 'the 14-day count leaves older days out');
select is(kc_private.user_active_days_purge(), 1, 'retention removes days older than 400 days');

-- ── Community numbers ────────────────────────────────────────────────────────
select is(pg_temp.get('b', $$select registered_users || '/' || open_public_posts || '/' || delivered_posts || '/' || (refreshed_at is null)
    from public.community_stats()$$), '0/0/0/true', 'before the first refresh the numbers are zero');
select lives_ok('select kc_private.community_stats_refresh()', 'the job recounts');
select is(pg_temp.get('b', $$select registered_users || '/' || open_public_posts || '/' || delivered_posts from public.community_stats()$$),
  '4/1/0', 'members read active members, open public posts and delivered posts');
select is(pg_temp.act(null, 'select * from public.community_stats()'), '42501', 'a signed-out caller reads no numbers');
select is(pg_temp.act('b', 'select kc_private.community_stats_refresh()'), '42501', 'a member cannot run the recount');

-- ── Timeline ─────────────────────────────────────────────────────────────────
select is(pg_temp.act('b', 'select public.reserve_item_giving(#01)') || '/'
       || pg_temp.act('a', 'select public.confirm_item_handoff((select id from public.post_handoffs))') || '/'
       || pg_temp.act('b', 'select public.mark_giving_handed_over((select id from public.post_handoffs))'), 'ok/ok/ok',
  'Bob receives the chair');
select is(pg_temp.get('a', $$select string_agg(kind || ':' || post_title, ',' order by kind, post_title) from public.my_activity_timeline()$$),
  'post_closed_delivered:a chair,post_created:a chair,post_created:a secret', 'the owner''s timeline lists what they published and delivered');
select is(pg_temp.get('b', $$select string_agg(kind || ':' || post_title || ':' || (actor_id = @a), ',') from public.my_activity_timeline()$$),
  'marked_as_recipient:a chair:true', 'the recipient''s timeline lists the handover and who gave');
select is(pg_temp.get('c', 'select count(*) from public.my_activity_timeline()'), '0', 'nobody sees another member''s activity');
select is(pg_temp.get('a', $$select string_agg(distinct world_slug, ',') from public.my_activity_timeline()$$), 'items',
  'each row names the world of its post, so the app can word a volunteering row as such');

select * from finish();
rollback;
