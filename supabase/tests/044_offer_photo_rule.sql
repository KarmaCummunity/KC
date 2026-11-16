-- D132: an offer in a photo world is published with a photo and keeps one; an edit replaces
-- the photos of a post in one call (replace_post_media, FR-POST-008 AC1, KC#2118).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

create function pg_temp.expand(p_sql text)
returns text language sql as $$
  select regexp_replace(regexp_replace(p_sql, '@([a-e])', '''00000000-0000-4000-8000-00000000000\1''::uuid', 'g'),
                        '#(\d\d)', '''10000000-0000-4000-8000-0000000000\1''::uuid', 'g');
$$;

-- One value of a query run as a member (null = signed out); an error returns its SQLSTATE,
-- or its message when it is a P0001 business error.
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

-- Runs a statement that returns nothing as a member: 'ok' or the error as above.
create function pg_temp.act(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_sql constant text := pg_temp.expand(p_sql);
begin
  perform set_config('request.jwt.claims', case when p_who is null then '{"role":"anon"}'
    else jsonb_build_object('sub', '00000000-0000-4000-8000-00000000000' || p_who, 'role', 'authenticated')::text end, true);
  perform set_config('role', case when p_who is null then 'anon' else 'authenticated' end, true);
  execute v_sql;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '{}', true);
  return 'ok';
exception when others then
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '{}', true);
  return case sqlstate when 'P0001' then sqlerrm else sqlstate end;
end;
$$;

-- The gallery of post NN as 'position:file,…' in order, or 'none'.
create function pg_temp.gallery(p_post text)
returns text
language sql
as $$
  select coalesce(string_agg(m.ordinal || ':' || split_part(m.storage_key, '/', 2), ',' order by m.ordinal), 'none')
    from public.post_media m
   where m.post_id = ('10000000-0000-4000-8000-0000000000' || p_post)::uuid;
$$;

-- The p_media argument for files N.jpg of member a, in the given order.
create function pg_temp.files(variadic p_names integer[])
returns text
language sql
as $$
  select jsonb_agg(jsonb_build_object(
           'storage_key', '00000000-0000-4000-8000-00000000000a/' || n || '.jpg',
           'mime_type', 'image/jpeg', 'size_bytes', 10) order by i)::text
    from unnest(p_names) with ordinality as t (n, i);
$$;

-- Replaces the gallery of post 01 as a member: 'ok' or the error.
create function pg_temp.set_gallery(p_who text, p_media text)
returns text
language sql
as $$
  select pg_temp.act(p_who, format('select public.replace_post_media(#01, %L::jsonb)', p_media));
$$;

select plan(22);

-- a owns the posts · c is a stranger
insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'c']) x;
insert into public.cities (city_id, name_he, name_en, location) values ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)');
insert into public.worlds (slug, label_he, label_en, default_anonymity_level) values
  ('items', 'items', 'items', 3), ('food', 'food', 'food', 3), ('rides', 'rides', 'rides', 3);
insert into public.post_kinds (id, world_slug, slug, label_he, label_en, direction)
select ('20000000-0000-4000-8000-00000000000' || n)::uuid, w, w || '_kind', w, w, 'either'
  from unnest(array['items', 'food', 'rides']) with ordinality as t (w, n);
-- 01 draft item offer · 02 draft item request · 03 draft food offer · 04 draft rides offer
insert into public.posts (id, owner_id, world_slug, kind_id, post_type, direction, status, title, city_id)
select ('10000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       '00000000-0000-4000-8000-00000000000a', w,
       (select k.id from public.post_kinds k where k.world_slug = w), 'standard', d, 'draft', 'post ' || n, 'c1'
  from (values (1, 'items', 'offer'), (2, 'items', 'request'), (3, 'food', 'offer'), (4, 'rides', 'offer')) as p (n, w, d);

select is(kc_private.offer_requires_photo('items', 'offer')::text || kc_private.offer_requires_photo('animals', 'offer')::text
  || kc_private.offer_requires_photo('items', 'request')::text || kc_private.offer_requires_photo('rides', 'offer')::text,
  'truetruefalsefalse', 'only offers in items, food, housing and animals need a photo');
select is(pg_temp.act('a', 'select public.publish_post(#01)'), 'offer_photo_required', 'an item offer without a photo is not published');
select is(pg_temp.act('a', 'select public.publish_post(#03)'), 'offer_photo_required', 'nor is a food offer');
select is(pg_temp.act('a', 'select public.publish_post(#02)'), 'ok', 'a request needs no photo');
select is(pg_temp.act('a', 'select public.publish_post(#04)'), 'ok', 'nor does a ride');
select is(pg_temp.act('a', $$insert into public.post_media (post_id, owner_id, storage_key, ordinal, mime_type, size_bytes)
    values (#01, @a, '00000000-0000-4000-8000-00000000000a/1.jpg', 0, 'image/jpeg', 10)$$), 'ok', 'the photo is attached to the draft');
select is(pg_temp.act('a', 'select public.publish_post(#01)'), 'ok', 'and the offer is published, whatever the file''s processing state');
select is(pg_temp.act('a', $$delete from public.post_media where post_id = #01$$), 'offer_photo_required', 'the last photo of an open offer cannot be removed');
select is(pg_temp.act('a', $$insert into public.post_media (post_id, owner_id, storage_key, ordinal, mime_type, size_bytes)
    values (#01, @a, '00000000-0000-4000-8000-00000000000a/2.jpg', 1, 'image/jpeg', 10)$$)
  || pg_temp.act('a', $$delete from public.post_media where post_id = #01 and ordinal = 0$$), 'okok', 'a photo can be replaced: add one, then remove the old');

-- ── An edit replaces the gallery in one call (KC#2118) ───────────────────────
-- The open offer holds one photo (2.jpg, second position).
select is(pg_temp.set_gallery('a', pg_temp.files(3)) || ' ' || pg_temp.gallery('01'), 'ok 0:3.jpg',
  'the only photo of an open offer is swapped for another');
select is(pg_temp.set_gallery('a', pg_temp.files(3, 4)) || ' ' || pg_temp.gallery('01'), 'ok 0:3.jpg,1:4.jpg', 'a photo is added');
create temp table kept_row on commit drop as
  select m.id from public.post_media m where m.storage_key like '%/3.jpg';
select is(pg_temp.set_gallery('a', pg_temp.files(3, 5)) || ' ' || pg_temp.gallery('01'), 'ok 0:3.jpg,1:5.jpg', 'one photo is exchanged');
select is((select count(*) from public.post_media m join kept_row k on k.id = m.id), 1::bigint,
  'a photo whose file and position did not change keeps its row');
select is(pg_temp.set_gallery('a', pg_temp.files(5)) || ' ' || pg_temp.gallery('01'), 'ok 0:5.jpg',
  'removing the first photo moves the next one up');
select is(pg_temp.set_gallery('a', '[]') || ' ' || pg_temp.gallery('01'), 'offer_photo_required 0:5.jpg',
  'an open offer is not left without a photo, and nothing changes');
select is(pg_temp.set_gallery('a', pg_temp.files(1, 2, 3, 4, 5, 6)), 'too_many_photos', 'a gallery holds five photos at most');
select is(pg_temp.set_gallery('a', '{}'), 'invalid_input', 'the photos are a list');
select is(pg_temp.set_gallery('c', pg_temp.files(7)), 'post_not_found', 'only the owner replaces the photos');
select is(pg_temp.set_gallery(null, pg_temp.files(7)), '42501', 'a signed-out caller cannot');
select is(pg_temp.act('a', $$select public.replace_post_media(#02, '[]'::jsonb)$$), 'ok', 'a request may hold no photo');
select is(pg_temp.act('a', $$delete from public.post_media where post_id = #01$$) || ' ' || pg_temp.gallery('01'),
  'offer_photo_required 0:5.jpg', 'a direct delete of the last photo stays refused after a replacement');

delete from public.post_media where post_id = '10000000-0000-4000-8000-000000000001';
select is((select count(*)::text from public.post_media), '0', 'server work removes files without the member rule');

select * from finish();
rollback;
