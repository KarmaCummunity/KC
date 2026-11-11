-- Translation: a cached translation is readable exactly when its source row is, written
-- by the service role only, and purged when the source is edited or removed.
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

-- Alice: 01 public post, 02 "only me" post. Bob comments. Carol and Alice are blocked.
insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b', 'c']) x;
insert into public.blocks (blocker_id, blocked_id) values
  ('00000000-0000-4000-8000-00000000000c', '00000000-0000-4000-8000-00000000000a');
insert into public.cities (city_id, name_he, name_en, location) values ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)');
insert into public.worlds (slug, label_he, label_en) values ('items', 'items', 'items');
insert into public.post_kinds (id, world_slug, slug, label_he, label_en, direction)
values ('20000000-0000-4000-8000-000000000001', 'items', 'item', 'item', 'item', 'either');
insert into public.posts (id, owner_id, world_slug, kind_id, direction, status, visibility, title, description, city_id) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'items',
   '20000000-0000-4000-8000-000000000001', 'offer', 'open', 'Public', 'a chair', 'wooden', 'c1'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-00000000000a', 'items',
   '20000000-0000-4000-8000-000000000001', 'offer', 'open', 'OnlyMe', 'a secret', null, 'c1');
insert into public.post_comments (id, post_id, author_id, body) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-00000000000b', 'nice');
update public.users set biography = 'hello' where id = '00000000-0000-4000-8000-00000000000a';

-- ── Writing ──────────────────────────────────────────────────────────────────
select is(pg_temp.act('s', $$insert into public.content_translations (content_type, content_id, field, target_language, translated_text) values
    ('post', #01, 'title', 'en', 'T1'), ('post', #01, 'description', 'en', 'D1'), ('post', #02, 'title', 'en', 'T2'),
    ('comment', '30000000-0000-4000-8000-000000000001', 'body', 'en', 'C1'), ('user', @a, 'biography', 'en', 'B1'),
    ('message', gen_random_uuid(), 'body', 'en', 'M1')$$), 'ok', 'the service role fills the cache');
select is(pg_temp.act('s', $$insert into public.content_translations (content_type, content_id, field, target_language, translated_text)
    values ('post', #01, 'title', 'en', 'again')$$), '23505', 'a second writer of the same key loses (single flight)');
select is(pg_temp.act('s', $$insert into public.content_translations (content_type, content_id, field, target_language, translated_text)
    values ('post', #01, 'body', 'en', 'x')$$), '23514', 'a field belongs to its kind of content');
select is(pg_temp.act('b', $$insert into public.content_translations (content_type, content_id, field, target_language, translated_text)
    values ('post', #01, 'title', 'fr', 'x')$$), '42501', 'a member cannot write the cache');
select is(pg_temp.act('b', 'delete from public.content_translations'), '42501', 'nor delete from it');

-- ── Reading follows the source row ───────────────────────────────────────────
select is(pg_temp.get('b', 'select count(*) from public.content_translations'), '4',
  'a member reads translations of the post, the comment and the profile they can see — not of a private post, not of a message');
select is(pg_temp.get('a', 'select count(*) from public.content_translations'), '5', 'the owner also reads their private post''s');
select is(pg_temp.get('c', 'select count(*) from public.content_translations'), '0', 'a blocked member reads none of them');
select is(pg_temp.act(null, 'select 1 from public.content_translations'), '42501', 'a signed-out caller reads nothing');
select is(pg_temp.get('b', $$select string_agg(field || '=' || translated_text, ',' order by field)
    from public.get_post_translations(array[#01, #02], 'en')$$), 'description=D1,title=T1',
  'the batched read returns cache hits of readable posts in the asked language');
select is(pg_temp.get('b', $$select count(*) from public.get_post_translations(array[#01], 'fr')$$), '0', 'another language is a miss');

-- ── Purge ────────────────────────────────────────────────────────────────────
update public.posts set urgency_level = 2 where id = '10000000-0000-4000-8000-000000000001';
select is((select count(*) from public.content_translations where content_type = 'post'), 3::bigint,
  'an edit of another field keeps the cache');
update public.posts set title = 'an armchair' where id = '10000000-0000-4000-8000-000000000001';
select is((select count(*) from public.content_translations where content_id = '10000000-0000-4000-8000-000000000001'), 0::bigint,
  'an edit of the text purges the post''s translations');
update public.post_comments set body = 'very nice' where id = '30000000-0000-4000-8000-000000000001';
update public.users set biography = 'hello again' where id = '00000000-0000-4000-8000-00000000000a';
select is((select string_agg(content_type, ',' order by content_type) from public.content_translations), 'message,post',
  'an edited comment and an edited biography purge theirs');
delete from public.posts where id = '10000000-0000-4000-8000-000000000002';
select is((select count(*) from public.content_translations where content_type = 'post'), 0::bigint,
  'a deleted post purges its translations');
insert into public.content_translations (content_type, content_id, field, target_language, translated_text)
values ('user', '00000000-0000-4000-8000-00000000000a', 'biography', 'en', 'B2');
delete from auth.users where id = '00000000-0000-4000-8000-00000000000a';
select is((select count(*) from public.content_translations where content_type = 'user'), 0::bigint,
  'removing a member purges theirs');

select * from finish();
rollback;
