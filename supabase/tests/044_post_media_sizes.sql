-- A post's photos keep the type and size recorded at upload (post_media): a placeholder
-- size or an unsupported type is refused, and the gallery of post_detail returns both, so
-- the owner can attach the same files to a republished post. A reader who cannot see the
-- post sees none of its files.
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

-- Alice attaches one file to the post as herself.
create function pg_temp.attach(p_post text, p_ordinal integer, p_mime text, p_size bigint)
returns text
language sql
as $$
  select pg_temp.as_member('a', format($q$insert into public.post_media (post_id, owner_id, storage_key, ordinal, mime_type, size_bytes)
      values (%L, '00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000a/' || %L || '/' || %s || '.jpg', %s, %L, %s)
      returning 'ok'$q$, p_post, right(p_post, 1), p_ordinal, p_ordinal, p_mime, p_size));
$$;

select plan(6);

insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b']) x;
insert into public.cities (city_id, name_he, name_en, location) values ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)');
insert into public.worlds (slug, label_he, label_en) values ('items', 'items', 'items');
insert into public.post_kinds (id, world_slug, slug, label_he, label_en, direction)
values ('20000000-0000-4000-8000-000000000001', 'items', 'item', 'item', 'item', 'either');
-- Post 1 is public, post 2 is Alice's alone.
insert into public.posts (id, owner_id, world_slug, kind_id, direction, status, visibility, title, city_id)
select ('40000000-0000-4000-8000-00000000000' || n)::uuid, '00000000-0000-4000-8000-00000000000a', 'items',
       '20000000-0000-4000-8000-000000000001', 'offer', 'open', v, 'post ' || n, 'c1'
  from (values (1, 'Public'), (2, 'OnlyMe')) p (n, v);

select is(pg_temp.attach('40000000-0000-4000-8000-000000000001', 0, 'image/jpeg', 0), '23514',
  'a placeholder size of zero bytes is refused');
select is(pg_temp.attach('40000000-0000-4000-8000-000000000001', 0, 'image/gif', 1000), '23514',
  'an image type the pipeline does not take is refused');
select is(pg_temp.attach('40000000-0000-4000-8000-000000000001', 0, 'image/png', 245760)
    || pg_temp.attach('40000000-0000-4000-8000-000000000002', 0, 'image/jpeg', 98304), 'okok',
  'a real type and size are recorded');
-- The media pipeline marks the files processed.
set local "kc.fsm_role" = 'system';
update public.post_media set processing_status = 'ready';
set local "kc.fsm_role" = '';

select is(pg_temp.as_member('b', $$select concat_ws('|', m ->> 'mime_type', m ->> 'size_bytes', m ->> 'storage_key')
      from jsonb_array_elements(public.post_detail('40000000-0000-4000-8000-000000000001') -> 'media') m$$),
  'image/png|245760|00000000-0000-4000-8000-00000000000a/1/0.jpg', 'the gallery returns the type and size of each file');
select is(pg_temp.as_member('a', $$select (public.post_detail('40000000-0000-4000-8000-000000000002') #>> '{media,0,size_bytes}')$$),
  '98304', 'the owner reads them on their own private post, to republish it');
select is(pg_temp.as_member('b', $$select coalesce(public.post_detail('40000000-0000-4000-8000-000000000002')::text, 'none')
      || '/' || (select count(*) from public.post_media where post_id = '40000000-0000-4000-8000-000000000002')$$),
  'none/0', 'another member sees neither the private post nor its files');

select * from finish();
rollback;
