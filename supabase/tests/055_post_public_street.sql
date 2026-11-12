-- The street other members see follows the poster's display level (0029, FR-POST-003 AC3,
-- FR-POST-019 AC5): CityAndStreet (the default) shows the street, FullAddress the street and
-- number, CityOnly nothing; a post the caller cannot read releases nothing; the exact point
-- and the access notes are never released.
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

create function pg_temp.shown(p_who text)
returns text
language sql
as $$
  select pg_temp.as_member(p_who, $q$
    select string_agg(p.title || '=' || coalesce(p.shown_street, '') || '/' || coalesce(p.shown_street_number, ''), ',' order by p.title)
      from public.posts p$q$);
$$;

select plan(7);

insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b']) x;
insert into public.cities (city_id, name_he, name_en, location) values ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)');
insert into public.worlds (slug, label_he, label_en) values ('items', 'items', 'items');
insert into public.post_kinds (id, world_slug, slug, label_he, label_en, direction)
values ('20000000-0000-4000-8000-000000000001', 'items', 'item', 'item', 'item', 'either');

insert into public.posts (owner_id, world_slug, kind_id, direction, status, visibility, title, city_id)
values ('00000000-0000-4000-8000-00000000000a', 'items', '20000000-0000-4000-8000-000000000001', 'offer', 'open', 'Public', 'p_default', 'c1');
insert into public.posts (owner_id, world_slug, kind_id, direction, status, visibility, title, city_id, location_display_level)
select '00000000-0000-4000-8000-00000000000a', 'items', '20000000-0000-4000-8000-000000000001', 'offer', 'open', v, t, 'c1', l
  from (values ('p_city', 'Public', 'CityOnly'), ('p_full', 'Public', 'FullAddress'), ('p_hidden', 'OnlyMe', 'FullAddress'))
       as x (t, v, l);
insert into public.post_private_locations (post_id, street, street_number, access_notes)
select id, 'Herzl', '12', 'code 1234' from public.posts;

select is((select location_display_level from public.posts where title = 'p_default'), 'CityAndStreet',
  'a new post shows city and street by default');
select is(pg_temp.shown('b'), 'p_city=/,p_default=Herzl/,p_full=Herzl/12',
  'another member sees the street of CityAndStreet, street and number of FullAddress, nothing of CityOnly; an OnlyMe post not at all');
select is(pg_temp.as_member('a', $$update public.posts set location_display_level = 'CityOnly' where title = 'p_full' returning null$$)
    || '|' || pg_temp.shown('b'), 'null|p_city=/,p_default=Herzl/,p_full=/',
  'lowering the level hides the street at once');
select is(pg_temp.as_member('a', $$update public.post_private_locations set street = 'Weizmann'
      where post_id = (select id from public.posts where title = 'p_default') returning null$$) || '|' || pg_temp.shown('b'),
  'null|p_city=/,p_default=Weizmann/,p_full=/', 'a changed street is shown at once');
select is(pg_temp.as_member('a', $$update public.posts set shown_street = 'Fake' where title = 'p_city'$$),
  'permission denied for table posts', 'the shown street is never written from a device');
select is(pg_temp.as_member('b', 'select count(*)::text from public.post_private_locations'), '0',
  'the private table, with the point and the access notes, stays closed to everyone but the owner');
select is(pg_temp.as_member(null, 'select count(*)::text from public.posts'), 'permission denied for table posts',
  'nothing of a post is readable signed out');

select * from finish();
rollback;
