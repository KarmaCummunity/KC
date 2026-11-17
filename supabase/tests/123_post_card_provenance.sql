-- Post cards carry provenance (FR-IMPORT-007 AC3, KC#2427): `source` and `source_platform` of the
-- post, so the app shows "from WhatsApp / Facebook / Yad2" on an imported post. A native post says
-- native with no platform; the card a viewer reads is the same card for owner and others.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- One field of a post's card, read as a signed-in member ('none' when the member gets no card).
create function pg_temp.card_field(p_viewer uuid, p_post uuid, p_field text)
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', p_viewer)::text, true);
  perform set_config('role', 'authenticated', true);
  select coalesce(to_jsonb(c) ->> p_field, '~') into v_value from public.post_cards(array[p_post]) c;
  perform set_config('role', 'none', true);
  return coalesce(v_value, 'none');
end;
$$;

-- Attaches an import to a post as the given member (the app's call after publishing).
create function pg_temp.attach_as(p_member uuid, p_import uuid, p_post uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', p_member)::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.api_import_attach_post(p_import, p_post);
  perform set_config('role', 'none', true);
end;
$$;

select plan(7);

insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data) values
  ('00000000-0000-4000-8000-00000000000a', 'alice@example.test', now(), '{"provider":"email"}'),
  ('00000000-0000-4000-8000-00000000000b', 'bob@example.test', now(), '{"provider":"email"}');
insert into public.cities (city_id, name_he, name_en, location) values
  ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)');
insert into public.worlds (slug, label_he, label_en) values ('items', 'items', 'Items');
insert into public.post_kinds (id, world_slug, slug, label_he, label_en, direction) values
  ('20000000-0000-4000-8000-000000000001', 'items', 'item', 'item', 'Item', 'either');
insert into public.posts (id, owner_id, world_slug, kind_id, direction, title, city_id) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'items', '20000000-0000-4000-8000-000000000001', 'offer', 'Sofa', 'c1'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-00000000000a', 'items', '20000000-0000-4000-8000-000000000001', 'offer', 'Table', 'c1');
insert into public.external_post_imports (id, user_id, channel, source_platform, text_fingerprint, routing, reason, extraction_version) values
  ('40000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'share', 'whatsapp', repeat('a', 64), 'confirm', 'ok', 'v1');

-- ── The type carries the two attributes ───────────────────────────────────────────────────────
select is((select string_agg(a.attname, ',' order by a.attnum)
             from pg_attribute a
            where a.attrelid = 'public.post_card'::regclass and a.attname in ('source', 'source_platform') and not a.attisdropped),
  'source,source_platform', 'the card type ends with the source and the platform');
select is((select count(*)::integer from public.post_cards(array[]::uuid[])), 0, 'an empty list still reads (the function compiles against the type)');

-- ── A native post ─────────────────────────────────────────────────────────────────────────────
select is(pg_temp.card_field('00000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-000000000002', 'source'),
  'native', 'a native post reads native on its card');
select is(pg_temp.card_field('00000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-000000000002', 'source_platform'),
  '~', 'and has no platform');

-- ── An imported post, through the real attach path ────────────────────────────────────────────
select lives_ok($$select pg_temp.attach_as('00000000-0000-4000-8000-00000000000a',
  '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001')$$,
  'the owner attaches the import to the post');
select is(pg_temp.card_field('00000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-000000000001', 'source')
          || '/' || pg_temp.card_field('00000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-000000000001', 'source_platform'),
  'imported/whatsapp', 'another member sees the post imported from WhatsApp');
select is(pg_temp.card_field('00000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-000000000001', 'source_platform'),
  'whatsapp', 'the owner sees the same provenance');

select * from finish();
rollback;
