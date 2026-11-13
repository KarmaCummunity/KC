-- Discovery reads (0031): follow suggestions leave out followed, blocked and private members;
-- the completeness nudge is the caller's own; organizations, #tags and suggested searches are
-- found; the About roster shows active members only.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

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
    return coalesce(v_value, 'null');
  exception when others then
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '{}', true);
    return case when sqlstate in ('P0001', '42501') then sqlerrm else sqlstate end;
  end;
end;
$$;

select plan(10);

-- Alice asks. Bob shares her city; Carol is followed by Bob, whom Alice follows; Dan is private;
-- Eve blocked Alice; Fay is already followed.
insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b', 'c', 'd', 'e', 'f']) x;
insert into public.cities (city_id, name_he, name_en, location) values
  ('c1', 'City One', 'City One', 'SRID=4326;POINT(34.78 32.08)'), ('c2', 'City Two', 'City Two', 'SRID=4326;POINT(34.99 32.79)');
update public.users set display_name = 'Member ' || right(id::text, 1), city_id = 'c2';
update public.users set city_id = 'c1' where id in ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b');
update public.users set privacy_mode = 'Private' where id = '00000000-0000-4000-8000-00000000000d';
insert into public.follows (follower_id, followed_id) values
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000f'),
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b'),
  ('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-00000000000c');
delete from public.follows where follower_id = '00000000-0000-4000-8000-00000000000a' and followed_id = '00000000-0000-4000-8000-00000000000b';
insert into public.follows (follower_id, followed_id) values
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b');
insert into public.blocks (blocker_id, blocked_id) values
  ('00000000-0000-4000-8000-00000000000e', '00000000-0000-4000-8000-00000000000a');

select is(pg_temp.as_member('a', $$select string_agg(display_name || ':' || reason, ',' order by score desc, display_name)
      from public.rpc_follow_suggestions()$$),
  'Member c:mutual_follow', 'only Carol is suggested, through a member Alice follows; followed, private and blocked ones are not');
select is(pg_temp.as_member('c', $$select count(*)::text from public.rpc_follow_suggestions()
      where share_handle = (select share_handle from public.users where id = '00000000-0000-4000-8000-00000000000d')$$),
  '0', 'a private profile is never suggested');
select is(pg_temp.as_member(null, 'select count(*)::text from public.rpc_follow_suggestions()'),
  'permission denied for function rpc_follow_suggestions', 'signed out, there is nothing to suggest');

select is(pg_temp.as_member('a', $$select (r ->> 'score') || '|' || (r -> 'missing')::text from public.rpc_profile_completeness() r$$),
  '30|["onboarding", "avatar", "biography"]', 'the nudge names what the caller''s profile lacks');
select is(pg_temp.as_member('a', $$select public.rpc_profile_completeness('00000000-0000-4000-8000-00000000000b')::text$$),
  'forbidden', 'nobody reads another member''s completeness');

-- Organizations and tags.
insert into public.organizations (slug, name, is_verified_nonprofit) values ('aid', 'Aid Center', true), ('helpers', 'Helpers', false);
insert into public.worlds (slug, label_he, label_en) values ('items', 'items', 'items');
insert into public.post_kinds (id, world_slug, slug, label_he, label_en, direction)
values ('20000000-0000-4000-8000-000000000001', 'items', 'item', 'item', 'item', 'either');
insert into public.posts (owner_id, world_slug, kind_id, direction, status, visibility, title, description, city_id)
select '00000000-0000-4000-8000-00000000000b', 'items', '20000000-0000-4000-8000-000000000001', 'offer', 'open', v, t, d, 'c1'
  from (values ('Sofa #furniture', '#Free pickup', 'Public'), ('Desk', 'nice #furniture', 'Public'),
               ('Secret #furnace', null, 'OnlyMe')) x (t, d, v);

select is(pg_temp.as_member('a', $$select string_agg(slug, ',') from public.search_organizations('aid')$$), 'aid',
  'organizations are found by name');
select is(pg_temp.as_member('a', $$select string_agg(tag || ':' || use_count, ',') from public.search_hashtags('#fur')$$),
  'furniture:2', 'tags are counted over the posts the caller can read only');
select is(pg_temp.as_member('a', $$select string_agg(q, ',') from public.search_suggested_queries() q$$),
  '#furniture,#free', 'suggested searches are the most used recent tags');

-- About roster.
insert into public.about_team_members (role_key, user_id, sort_order) values
  ('founder', '00000000-0000-4000-8000-00000000000b', 1), ('former', '00000000-0000-4000-8000-00000000000c', 2);
update public.users set is_active = false where id = '00000000-0000-4000-8000-00000000000c';
select is(pg_temp.as_member('a', $$select string_agg(role_key || ':' || display_name, ',') from public.about_team_profiles()$$),
  'founder:Member b', 'the roster shows active members with their public name');
select is(pg_temp.as_member('a', 'select count(*)::text from public.about_team_members'),
  'permission denied for table about_team_members', 'the roster table itself is not readable');

select * from finish();
rollback;
