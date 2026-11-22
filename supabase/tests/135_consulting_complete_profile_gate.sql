-- Consulting hour complete-profile gate (FR-KNOW-012 AC1, D184, #2038).
-- A member below verification_level 1 cannot offer a consulting hour; level 1 without ID can.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

create function pg_temp.act(p_who text, p_sql text)
returns text
language plpgsql
as $$
begin
  begin
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', '00000000-0000-4000-8000-00000000000' || p_who,
      'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    execute p_sql;
    perform set_config('role', 'none', true);
    return 'ok';
  exception when others then
    perform set_config('role', 'none', true);
    return case sqlstate when 'P0001' then sqlerrm else sqlstate end;
  end;
end;
$$;

select plan(2);

insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b']) x;
insert into public.cities (city_id, name_he, name_en, location) values
  ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)');
insert into public.worlds (slug, label_he, label_en)
values ('knowledge', 'ידע', 'Knowledge')
on conflict (slug) do nothing;
insert into public.post_kinds (world_slug, slug, label_he, label_en, direction)
values ('knowledge', 'consulting_hour', 'שעת ייעוץ', 'Consulting hour', 'offer')
on conflict (world_slug, slug) do nothing;

-- a: incomplete profile. b: complete profile, not ID-verified.
update public.users set verification_level = 0
  where id = '00000000-0000-4000-8000-00000000000a';
update public.users set verification_level = 1
  where id = '00000000-0000-4000-8000-00000000000b';

select is(
  pg_temp.act('a', $sql$
    insert into public.posts
      (owner_id, world_slug, kind_id, direction, status, title, city_id, details)
    select '00000000-0000-4000-8000-00000000000a', 'knowledge', id, 'offer', 'draft',
           'consult incomplete', 'c1',
           '{"profession":"lawyer","modality":"video","capacity_per_slot":1,
             "disclaimer_accepted":true,
             "slots":[{"starts_at":"2099-01-01T10:00:00Z","ends_at":"2099-01-01T11:00:00Z"}]}'::jsonb
      from public.post_kinds where world_slug = 'knowledge' and slug = 'consulting_hour'
  $sql$),
  'consulting_requires_complete_profile',
  'a member below complete profile cannot offer a consulting hour');

select is(
  pg_temp.act('b', $sql$
    insert into public.posts
      (owner_id, world_slug, kind_id, direction, status, title, city_id, details)
    select '00000000-0000-4000-8000-00000000000b', 'knowledge', id, 'offer', 'draft',
           'consult complete', 'c1',
           '{"profession":"lawyer","modality":"video","capacity_per_slot":1,
             "disclaimer_accepted":true,
             "slots":[{"starts_at":"2099-01-01T10:00:00Z","ends_at":"2099-01-01T11:00:00Z"}]}'::jsonb
      from public.post_kinds where world_slug = 'knowledge' and slug = 'consulting_hour'
  $sql$),
  'ok',
  'a complete-profile member can offer a consulting hour without ID verification');

select * from finish();
rollback;
