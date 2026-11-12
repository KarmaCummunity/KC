-- Links and knowledge of a giving world (migration 0024): everyone reads what is live, signed
-- in or not; only a platform admin writes; an alias is unique once normalized and is as
-- visible as its topic.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

create function pg_temp.become(p_who text)
returns void
language plpgsql
as $$
begin
  if p_who is null or p_who = 'none' then
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '{}', true);
  else
    perform set_config('request.jwt.claims', case when p_who in ('anon', 'service_role')
      then jsonb_build_object('role', p_who)
      else jsonb_build_object('sub', '00000000-0000-4000-8000-00000000000' || p_who, 'role', 'authenticated') end::text, true);
    perform set_config('role', case when p_who in ('anon', 'service_role') then p_who else 'authenticated' end, true);
  end if;
end;
$$;
grant execute on function pg_temp.become(text) to public;

-- Runs a statement as a member, `anon` or `service_role`: 'ok', the P0001 message, or the SQLSTATE.
create function pg_temp.act(p_who text, p_sql text)
returns text
language plpgsql
as $$
begin
  begin
    perform pg_temp.become(p_who);
    execute p_sql;
    perform pg_temp.become('none');
    return 'ok';
  exception when others then
    perform pg_temp.become('none');
    return case sqlstate when 'P0001' then sqlerrm else sqlstate end;
  end;
end;
$$;

-- One value read as a member or role. Reads that follow a write go through here too: a STABLE
-- function called directly in the same SELECT would be evaluated before the write runs.
create function pg_temp.val(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  perform pg_temp.become(p_who);
  execute p_sql into v_value;
  perform pg_temp.become('none');
  return v_value;
end;
$$;

select plan(15);

-- a platform admin · b an ordinary member.
insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(string_to_array('a,b', ',')) x;
insert into public.admin_role_grants (user_id, role) values ('00000000-0000-4000-8000-00000000000a', 'admin');

insert into public.worlds (slug, label_he, label_en) values ('w_one', 'one', 'One'), ('w_two', 'two', 'Two');
insert into public.world_links (from_world_slug, to_world_slug, link_slug, label_he, label_en, is_active) values
  ('w_one', 'w_two', 'live_link', 'live', 'Live', true),
  ('w_one', 'w_two', 'hidden_link', 'hidden', 'Hidden', false);
insert into public.external_bodies (slug, world_slug, label_he, label_en, body_type, contact_url, is_active) values
  ('live_body', 'w_one', 'live', 'Live', 'ngo', 'https://example.test', true),
  ('hidden_body', 'w_one', 'hidden', 'Hidden', 'ngo', null, false);
insert into public.knowledge_topics (slug, world_slug, label_he, label_en, status) values
  ('live-topic', 'w_one', 'live', 'Live', 'active'),
  ('proposed-topic', 'w_one', 'proposed', 'Proposed', 'proposed');
insert into public.knowledge_topic_aliases (topic_id, alias, lang)
select t.id, t.slug || ' alias', 'en' from public.knowledge_topics t where t.world_slug = 'w_one';

-- ── Read ────────────────────────────────────────────────────────────────────
create function pg_temp.visible(p_who text)
returns text
language sql
as $$
  select pg_temp.val(p_who, 'select count(*) from public.world_links where from_world_slug = ''w_one''')
    || pg_temp.val(p_who, 'select count(*) from public.external_bodies where world_slug = ''w_one''')
    || pg_temp.val(p_who, 'select count(*) from public.knowledge_topics where world_slug = ''w_one''')
    || pg_temp.val(p_who, 'select count(*) from public.knowledge_topic_aliases where alias like ''%-topic alias''');
$$;
select is(pg_temp.visible('anon'), '1111', 'a guest reads the live link, body, topic and its alias only');
select is(pg_temp.visible('b'), '1111', 'a member reads the same live rows');
select is(pg_temp.visible('a'), '2222', 'a platform admin also reads the hidden and proposed rows');

-- ── Write ───────────────────────────────────────────────────────────────────
select is(pg_temp.act('b', 'insert into public.world_links (from_world_slug, to_world_slug, link_slug, label_he, label_en) values (''w_two'', ''w_one'', ''mine'', ''x'', ''X'')')
  || pg_temp.act('b', 'insert into public.external_bodies (slug, world_slug, label_he, label_en, body_type) values (''mine'', ''w_one'', ''x'', ''X'', ''ngo'')')
  || pg_temp.act('b', 'insert into public.knowledge_topics (slug, world_slug, label_he, label_en) values (''mine'', ''w_one'', ''x'', ''X'')')
  || pg_temp.act('b', 'insert into public.knowledge_topic_aliases (topic_id, alias) select id, ''mine'' from public.knowledge_topics where slug = ''live-topic''')
  || pg_temp.act('anon', 'insert into public.world_links (from_world_slug, to_world_slug, link_slug, label_he, label_en) values (''w_two'', ''w_one'', ''mine'', ''x'', ''X'')'),
  '4250142501425014250142501', 'a member and a guest cannot add a link, a body, a topic or an alias');
select is(pg_temp.act('b', 'update public.world_links set label_he = ''changed''')
  || pg_temp.act('b', 'delete from public.external_bodies')
  || pg_temp.act('b', 'delete from public.knowledge_topic_aliases')
  || (select count(*) from public.world_links where label_he = 'changed')
  || (select count(*) from public.external_bodies where world_slug = 'w_one')
  || (select count(*) from public.knowledge_topic_aliases a join public.knowledge_topics t on t.id = a.topic_id where t.world_slug = 'w_one'),
  'okokok022', 'a member''s update and delete touch no row');
select is(pg_temp.act('a', 'insert into public.world_links (from_world_slug, to_world_slug, link_slug, label_he, label_en) values (''w_two'', ''w_one'', ''back'', ''x'', ''X'')')
  || pg_temp.act('a', 'update public.external_bodies set is_active = true where slug = ''hidden_body''')
  || pg_temp.act('a', 'update public.knowledge_topics set status = ''active'' where slug = ''proposed-topic''')
  || pg_temp.act('a', 'delete from public.world_links where link_slug = ''hidden_link''')
  || pg_temp.visible('b'),
  'okokokok1222', 'a platform admin adds, edits, publishes and removes; members then see the result');

-- ── Rules of the data ───────────────────────────────────────────────────────
select is(kc_private.knowledge_normalize_text(U&'  J\05B8ava-Script!  \05E4\05D9\05D9\05EA\05D5\05DF '), U&'java script \05E4\05D9\05D9\05EA\05D5\05E0',
  'an alias is compared in lower case, without niqqud or punctuation, final letters folded');
select throws_ok(
  $$insert into public.knowledge_topic_aliases (topic_id, alias) select id, 'LIVE-TOPIC  Alias' from public.knowledge_topics where slug = 'proposed-topic'$$,
  '23505', null, 'two aliases with the same normal form cannot both exist');
select throws_ok(
  $$insert into public.world_links (from_world_slug, to_world_slug, link_slug, label_he, label_en) values ('w_one', 'w_one', 'self', 'x', 'X')$$,
  '23514', null, 'a world does not link to itself');
select throws_ok(
  $$update public.knowledge_topics set status = 'merged' where slug = 'proposed-topic'$$,
  '23514', null, 'a merged topic names the topic that replaced it');

-- ── The topic graph (machine `knowledge_topic`) ─────────────────────
-- `proposed-topic` was approved above, so it is active now.
select throws_ok(
  $$update public.knowledge_topics set status = 'proposed' where slug = 'proposed-topic'$$,
  'P0001', 'illegal_transition', 'an approved topic never goes back to a suggestion');
select lives_ok(
  $$update public.knowledge_topics set status = 'merged',
           merged_into_id = (select id from public.knowledge_topics where slug = 'live-topic')
     where slug = 'proposed-topic'$$,
  'an active topic is merged into another');
select throws_ok(
  $$update public.knowledge_topics set status = 'active', merged_into_id = null where slug = 'proposed-topic'$$,
  'P0001', 'illegal_transition', 'a merged topic is never revived');
select throws_ok(
  $$insert into public.knowledge_topics (slug, world_slug, label_he, label_en, status) values ('odd', 'w_one', 'x', 'X', 'archived')$$,
  'P0001', 'unknown_state', 'a topic is created only in a state of the graph');

-- ── Content leaves with its world ───────────────────────────────────────────
delete from public.worlds where slug = 'w_one';
select is((select count(*) from public.world_links) + (select count(*) from public.external_bodies)
  + (select count(*) from public.knowledge_topics) + (select count(*) from public.knowledge_topic_aliases),
  0::bigint, 'deleting a world removes its links, bodies, topics and their aliases');

select * from finish();
rollback;
