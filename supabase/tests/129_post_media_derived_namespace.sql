-- The server-made photo copies (KC#2316) live in a namespace no member and no signed-out caller
-- can write: not insert, not overwrite (upsert), not update, not delete — whatever the spelling of
-- the path. Only the service role writes there. Otherwise an owner could replace a "sanitized"
-- copy with arbitrary bytes after it went `ready`, or pre-seed its key so processing is denied.
-- Keys are taken from kc_private.post_media_derivative_key, the function the worker must match.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Runs a statement as 'a', 'b', signed out (null) or 'service': rows affected, or the error.
create function pg_temp.act(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_rows bigint;
  v_role text := case when p_who is null then 'anon' when p_who = 'service' then 'service_role' else 'authenticated' end;
begin
  begin
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', case when p_who in ('a', 'b') then '00000000-0000-4000-8000-00000000000' || p_who end,
      'role', v_role)::text, true);
    perform set_config('role', v_role, true);
    execute p_sql;
    get diagnostics v_rows = row_count;
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '{}', true);
    return v_rows::text;
  exception when others then
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '{}', true);
    return sqlstate;
  end;
end;
$$;

create function pg_temp.put(p_name text) returns text
language sql as $$
  select format($q$insert into storage.objects (bucket_id, name, metadata)
                   values ('post-images', %L, '{"mimetype":"image/jpeg","size":"10"}')$q$, p_name);
$$;

create function pg_temp.exists_obj(p_name text) returns boolean
language sql as $$ select exists (select 1 from storage.objects where bucket_id = 'post-images' and name = p_name); $$;

select plan(16);

insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b']) x;

-- The key the worker writes for one of Alice's photos (attempt 1), and spellings of it.
create temp table k as
select kc_private.post_media_derivative_key('00000000-0000-4000-8000-00000000000a',
                                            '50000000-0000-4000-8000-000000000001', 1) as key;
grant select on k to anon, authenticated, service_role;

select ok((select key from k) not like '00000000-0000-4000-8000-00000000000a/%',
  'the copy is not stored inside the owner''s own (member-writable) folder');

-- ── A member (even the photo's owner) cannot write the namespace ─────────────────────────────
select is(pg_temp.act('a', pg_temp.put((select key from k))), '42501',
  'the owner cannot pre-seed the key the worker will write');
select is(pg_temp.act('b', pg_temp.put((select key from k))), '42501', 'nor can another member');
select is(pg_temp.act(null, pg_temp.put((select key from k))), '42501', 'nor a signed-out caller');
select is(pg_temp.act('a', pg_temp.put(upper(left((select key from k), 7)) || substr((select key from k), 8)))
    || pg_temp.act('a', pg_temp.put('/' || (select key from k)))
    || pg_temp.act('a', pg_temp.put(replace((select key from k), '/', '//')))
    || pg_temp.act('a', pg_temp.put('derived/00000000-0000-4000-8000-00000000000a/nested/deeper/x.jpg')),
  '42501425014250142501', 'case, leading or doubled slashes and nested folders do not open it');

-- ── The service role writes it ───────────────────────────────────────────────────────────────
select is(pg_temp.act('service', pg_temp.put((select key from k))), '1', 'the service role can store the copy');

-- ── After it is stored, no member can replace, change or remove it ───────────────────────────
select is(pg_temp.act('a', format($q$delete from storage.objects where bucket_id = 'post-images' and name = %L$q$, (select key from k))),
  '0', 'the owner cannot delete the stored copy (to re-insert other bytes)');
select is(pg_temp.act('a', format($q$update storage.objects set metadata = '{"size":"1"}' where bucket_id = 'post-images' and name = %L$q$, (select key from k))),
  '0', 'the owner cannot update it');
select is(pg_temp.act('a', pg_temp.put((select key from k)) || ' on conflict do nothing'),
  '42501', 'the owner cannot overwrite it (insert at the same key)');
select is(pg_temp.act('a', format($q$update storage.objects set name = %L where bucket_id = 'post-images' and name = %L$q$,
    '00000000-0000-4000-8000-00000000000a/moved.jpg', (select key from k))),
  '0', 'nor move it out of the namespace');
select ok(pg_temp.exists_obj((select key from k)), 'the copy is still there');

-- A member cannot move one of their own files INTO the namespace either.
select pg_temp.act('service', pg_temp.put('00000000-0000-4000-8000-00000000000a/b/0.jpg'));
select is(pg_temp.act('a', format($q$update storage.objects set name = %L where bucket_id = 'post-images' and name = %L$q$,
    (select key from k) || '.x', '00000000-0000-4000-8000-00000000000a/b/0.jpg')),
  '0', 'a member file cannot be renamed into the namespace');

-- ── Member uploads keep working; only the service role removes copies ────────────────────────
select is(pg_temp.act('a', pg_temp.put('00000000-0000-4000-8000-00000000000a/b/1.jpg')), '1',
  'a member still uploads into their own folder');
select is(pg_temp.act('service', format($q$delete from storage.objects where bucket_id = 'post-images' and name = %L$q$, (select key from k))),
  '1', 'the service role can remove a copy (orphan reconciliation)');

-- ── A device cannot record a row that points into the namespace ─────────────────────────────
insert into public.cities (city_id, name_he, name_en, location) values ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)');
insert into public.worlds (slug, label_he, label_en) values ('items', 'items', 'items');
insert into public.post_kinds (id, world_slug, slug, label_he, label_en, direction)
values ('20000000-0000-4000-8000-000000000001', 'items', 'item', 'item', 'item', 'either');
insert into public.posts (id, owner_id, world_slug, kind_id, direction, status, visibility, title, city_id)
values ('40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'items',
        '20000000-0000-4000-8000-000000000001', 'request', 'open', 'Public', 'p', 'c1');
select is(pg_temp.act('a', format($q$insert into public.post_media (post_id, owner_id, storage_key, ordinal, mime_type, size_bytes)
    values ('40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', %L, 0, 'image/jpeg', 10)$q$,
    (select key from k))),
  '23514', 'a member''s new (pending) row cannot claim a key in the namespace');
select is(pg_temp.act('a', format($q$insert into public.post_media (post_id, owner_id, storage_key, ordinal, mime_type, size_bytes)
    values ('40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', %L, 0, 'image/jpeg', 10)$q$,
    '00000000-0000-4000-8000-00000000000a/b/1.jpg')),
  '1', 'a member''s row for their own upload is recorded as before');

select * from finish();
rollback;
