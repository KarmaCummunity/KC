-- The apartment, floor and entrance of a stay are separate private fields (0033): the owner
-- writes and reads them back, another member reads nothing, and the confirmed guest's release
-- carries them.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

create function pg_temp.act(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  begin
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', '00000000-0000-4000-8000-00000000000' || p_who, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
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

select plan(4);

insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b']) x;
insert into public.cities (city_id, name_he, name_en, location) values ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)');
insert into public.worlds (slug, label_he, label_en) values ('items', 'items', 'items');
insert into public.post_kinds (id, world_slug, slug, label_he, label_en, direction)
values ('20000000-0000-4000-8000-000000000001', 'items', 'item', 'item', 'item', 'either');
insert into public.posts (id, owner_id, world_slug, kind_id, direction, status, title, city_id)
values ('30000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'items',
        '20000000-0000-4000-8000-000000000001', 'offer', 'open', 'Room', 'c1');

select is(pg_temp.act('a', $$insert into public.post_private_locations (post_id, street, street_number, apartment, floor, entrance_notes, access_notes)
      values ('30000000-0000-4000-8000-000000000001', 'Herzl', '5', '12', '3', 'Gate B', 'Code 1234') returning 'ok'$$),
  'ok', 'the owner writes the apartment, floor and entrance');
select is(pg_temp.act('a', $$select apartment || '|' || floor || '|' || entrance_notes || '|' || access_notes
      from public.post_private_locations$$), '12|3|Gate B|Code 1234', 'and reads them back as written, not folded');
select is(pg_temp.act('b', 'select count(*)::text from public.post_private_locations'), '0', 'another member reads nothing');
insert into public.post_handoffs (post_id, recipient_id, status)
values ('30000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000b', 'confirmed');
select is(pg_temp.act('b', $$select (l).apartment || '|' || (l).floor || '|' || (l).entrance_notes
      from public.get_post_private_location('30000000-0000-4000-8000-000000000001') l$$),
  '12|3|Gate B', 'the member of a confirmed handoff receives them with the address');

select * from finish();
rollback;
