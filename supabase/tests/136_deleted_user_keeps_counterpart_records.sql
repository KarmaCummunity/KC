-- Deleted user (#2088): the records of the other member survive the deletion of an account.
-- A member who asks to be deleted ends their live handoffs and the counterpart is told. At the
-- purge, a post handed over to a member who stays is kept without the deleted owner's text,
-- photos or address; every other post of theirs goes; a handoff keeps the member who stays and
-- NULL for the one who left. Re-running changes nothing. Reads show "no owner" (NULL id, not
-- masked) to the counterpart only, never the deleted member's name. A hidden-name post stays
-- distinct (masked). Guards do not open for a NULL member, and a member deleted on both sides
-- of one handoff violates nothing.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Handoffs by name: a deleted recipient cannot be found by member any more.
create temp table named_handoff (name text primary key, id uuid not null) on commit drop;

-- Test shorthand inside SQL text: @a … @f are the members, #NN a post, ~name a named handoff.
create function pg_temp.expand(p_sql text)
returns text
language plpgsql
as $$
declare
  v_sql text := p_sql;
  v_match text[];
begin
  for v_match in select regexp_matches(p_sql, '~([a-z0-9]+)', 'g') loop
    v_sql := replace(v_sql, '~' || v_match[1], coalesce(quote_literal(
      (select n.id from pg_temp.named_handoff n where n.name = v_match[1])), 'null') || '::uuid');
  end loop;
  v_sql := regexp_replace(v_sql, '@([a-f])', '''00000000-0000-4000-8000-00000000000\1''::uuid', 'g');
  return regexp_replace(v_sql, '#(\d\d)', '''10000000-0000-4000-8000-0000000000\1''::uuid', 'g');
end;
$$;

-- Runs a statement as a signed-in member. Returns 'ok', the message of a P0001 error, or the
-- SQLSTATE of any other error.
create function pg_temp.act(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_sql constant text := pg_temp.expand(p_sql);
begin
  begin
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', '00000000-0000-4000-8000-00000000000' || p_who, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    execute v_sql;
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '{}', true);
    return 'ok';
  exception when others then
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '{}', true);
    return case sqlstate when 'P0001' then sqlerrm else sqlstate end;
  end;
end;
$$;

-- One value a member reads (as text).
create function pg_temp.read(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_sql constant text := pg_temp.expand(p_sql);
  v_value text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', '00000000-0000-4000-8000-00000000000' || p_who, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute v_sql into v_value;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '{}', true);
  return v_value;
end;
$$;

-- One value read as the database owner.
create function pg_temp.val(p_sql text)
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  execute pg_temp.expand(p_sql) into v_value;
  return v_value;
end;
$$;

-- Notification events of a kind addressed to a member.
create function pg_temp.notified(p_kind text, p_who text)
returns bigint
language sql
as $$
  select count(*) from kc_private.outbox_events e
   where e.topic = 'notification' and e.payload ->> 'kind' = p_kind
     and e.payload ->> 'recipient_id' = '00000000-0000-4000-8000-00000000000' || p_who;
$$;

-- Everything of a post the scrub or a re-run could change.
create function pg_temp.snapshot(p_post text)
returns text
language sql
as $$
  select md5(coalesce((select to_jsonb(p)::text from public.posts p where p.id = p_post::uuid), '')
    || coalesce((select string_agg(to_jsonb(h)::text, '|' order by h.id) from public.post_handoffs h
                  where h.post_id = p_post::uuid), '')
    || (select count(*) from public.post_media m where m.post_id = p_post::uuid)
    || (select count(*) from public.post_private_locations l where l.post_id = p_post::uuid)
    || (select count(*) from public.content_translations t where t.content_id = p_post::uuid)
    || (select count(*) from kc_private.outbox_events));
$$;

select plan(41);

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- Zelda (a) deletes her account. Bob (b) received her post 01, and Fay's (f) post 06. Carol (c)
-- is a stranger. Dan (d) has reserved Zelda's post 02. Eve (e) gave Zelda post 05, has
-- confirmed her for post 04, and hides her name on post 07.
insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b', 'c', 'd', 'e', 'f']) x;
update public.users u set display_name = m.name from (values ('a', 'Zelda Gone'), ('b', 'Bob'),
    ('c', 'Carol'), ('d', 'Dan'), ('e', 'Eve'), ('f', 'Fay')) m (who, name)
 where u.id = ('00000000-0000-4000-8000-00000000000' || m.who)::uuid;
insert into public.cities (city_id, name_he, name_en, location) values
  ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)');
insert into public.worlds (slug, label_he, label_en) values ('items', 'items', 'items');
insert into public.post_kinds (id, world_slug, slug, label_he, label_en, direction) values
  ('20000000-0000-4000-8000-000000000001', 'items', 'items_kind', 'items', 'items', 'either');
insert into public.posts (id, owner_id, world_slug, kind_id, direction, status, title, description, city_id)
select ('10000000-0000-4000-8000-0000000000' || n)::uuid, ('00000000-0000-4000-8000-00000000000' || o)::uuid,
       'items', '20000000-0000-4000-8000-000000000001', 'offer', 'open',
       case o when 'a' then 'Zelda''s post ' else 'post ' end || n,
       case o when 'a' then 'Call Zelda at home' end, 'c1'
  from (values ('01', 'a'), ('02', 'a'), ('03', 'a'), ('04', 'e'), ('05', 'e'), ('06', 'f'), ('07', 'e')) v (n, o);
insert into public.post_private_locations (post_id, street, street_number, access_notes) values
  ('10000000-0000-4000-8000-000000000001', 'Herzl', '7', 'ring Zelda');
insert into public.post_media (post_id, owner_id, storage_key, ordinal, mime_type, size_bytes, processing_status) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a',
   '00000000-0000-4000-8000-00000000000a/p1/1.jpg', 0, 'image/jpeg', 1000, 'ready');
insert into public.content_translations (content_type, content_id, field, target_language, translated_text) values
  ('post', '10000000-0000-4000-8000-000000000001', 'title', 'en', 'Zelda''s post');

insert into public.post_handoffs (post_id, recipient_id, status) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000b', 'confirmed'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-00000000000d', 'reserved'),
  ('10000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-00000000000a', 'confirmed'),
  ('10000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-00000000000a', 'confirmed'),
  ('10000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-00000000000b', 'confirmed');
insert into pg_temp.named_handoff (name, id)
select 'h' || right(h.post_id::text, 2), h.id from public.post_handoffs h;
select is(pg_temp.act('a', 'select public.mark_giving_handed_over(~h01)') || pg_temp.act('e', 'select public.mark_giving_handed_over(~h05)')
    || pg_temp.act('f', 'select public.mark_giving_handed_over(~h06)'), 'okokok', 'three posts are handed over');
insert into public.post_ratings (handoff_id, rater_id, ratee_id, stars) values
  ((select id from pg_temp.named_handoff where name = 'h05'), '00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000e', 5),
  ((select id from pg_temp.named_handoff where name = 'h01'), '00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-00000000000a', 4);
select is(pg_temp.act('e', $$select public.upsert_post_actor_identity(#07, 'Public', false, 'Hidden')$$), 'ok',
  'Eve hides her name on post 07');

-- ── 1. Schema ───────────────────────────────────────────────────────────────
select col_is_null('public', 'posts', 'owner_id', 'posts.owner_id is nullable');
select col_is_null('public', 'post_handoffs', 'owner_id', 'post_handoffs.owner_id is nullable');
select col_is_null('public', 'post_handoffs', 'recipient_id', 'post_handoffs.recipient_id is nullable');
select is((select string_agg(conname || ':' || confdeltype::text || ':' || convalidated, ',' order by conname) from pg_constraint
            where conname in ('posts_owner_id_fkey', 'post_handoffs_owner_id_fkey', 'post_handoffs_recipient_id_fkey')),
  'post_handoffs_owner_id_fkey:n:true,post_handoffs_recipient_id_fkey:n:true,posts_owner_id_fkey:n:true',
  'the three member keys set NULL on delete and are validated');
select throws_ok($$update public.post_handoffs set recipient_id = owner_id
                    where id = (select id from pg_temp.named_handoff where name = 'h01')$$,
  '23514', null, 'the two members of a handoff still differ');

-- ── 2. pending_deletion ends the live handoffs and tells the counterpart ────
select is(pg_temp.act('a', 'select public.request_account_deletion()'), 'ok', 'Zelda asks to be deleted');
select is(pg_temp.val('select status || ''/'' || cancel_reason from public.post_handoffs where id = ~h02')
    || ' ' || pg_temp.val('select status || ''/'' || cancel_reason from public.post_handoffs where id = ~h04'),
  'cancelled/system cancelled/system', 'her live handoffs, as owner and as recipient, are cancelled by the system');
select is(pg_temp.notified('giving_handoff_cancelled', 'd') || '/' || pg_temp.notified('giving_handoff_cancelled', 'e')
    || '/' || pg_temp.notified('giving_handoff_cancelled', 'a'), '1/1/0',
  'each counterpart is notified, the member who asked is not');
select is(pg_temp.val('select string_agg(status, '','' order by post_id) from public.post_handoffs where id in (~h01, ~h05)'),
  'handed_over,handed_over', 'completed handoffs are untouched');
select is(pg_temp.read('c', 'select count(*) from public.post_cards(array[#03])'), '0',
  'in the grace period her posts are not shown to others');
select is(pg_temp.read('c', $$select count(*) from public.search_users_page('Zelda')$$), '0',
  'and she is not found by name');

-- ── 3. The purge keeps the other member's records ───────────────────────────
update public.user_account set deletion_purge_at = now() - interval '1 day'
 where user_id = '00000000-0000-4000-8000-00000000000a';
select lives_ok($$select kc_private.account_purge_prepare('00000000-0000-4000-8000-00000000000a')$$, 'the purge is prepared');
select is(kc_private.account_purge_finish('00000000-0000-4000-8000-00000000000a'), true, 'the purge removes Zelda');
select is(pg_temp.val('select count(*) from public.users where id = @a'), '0', 'her member row is gone');
select is(pg_temp.val('select string_agg(right(id::text, 2), '','' order by id) from public.posts'),
  '01,04,05,06,07', 'her post handed over to Bob stays; her posts that nobody received are deleted');
select is(pg_temp.val($$select coalesce(owner_id::text, 'null') || '|' || title || '|' || coalesce(description, 'null') || '|'
    || location_display_level || '|' || coalesce(shown_street, 'null') || '|' || status from public.posts where id = #01$$),
  'null|—|null|CityOnly|null|closed_delivered', 'the kept post has no owner, no text of hers and no street');
select is(pg_temp.val('select count(*) from public.post_media where post_id = #01') || '/'
    || pg_temp.val('select count(*) from public.post_private_locations where post_id = #01') || '/'
    || pg_temp.val('select count(*) from public.content_translations where content_id = #01'),
  '0/0/0', 'its photos, exact address and translations are gone');
select is(pg_temp.val($$select coalesce(owner_id::text, 'null') || '|' || right(recipient_id::text, 1) || '|' || status
    from public.post_handoffs where id = ~h01$$), 'null|b|handed_over', 'Bob''s handoff stays, with no giver');
select is(pg_temp.val($$select right(owner_id::text, 1) || '|' || coalesce(recipient_id::text, 'null') || '|' || status
    from public.post_handoffs where id = ~h05$$), 'e|null|handed_over', 'Eve''s handoff to Zelda stays, with no receiver');
select is(pg_temp.val($$select count(*) || '/' || count(rater_id) || '/' || count(handoff_id) from public.post_ratings
    where ratee_id = @e$$), '1/0/1', 'the rating Zelda gave Eve stays, without its author');
select is(pg_temp.val('select items_given_count || ''/'' || items_received_count from public.user_stats where user_id = @e'),
  '1/0', 'Eve''s counters are untouched');

-- ── 4. Idempotent ───────────────────────────────────────────────────────────
create temp table before_rerun on commit drop as
select pg_temp.snapshot('10000000-0000-4000-8000-000000000001') as p01,
       pg_temp.snapshot('10000000-0000-4000-8000-000000000005') as p05;
select lives_ok($$select kc_private.account_keep_counterpart_records('00000000-0000-4000-8000-00000000000a')$$,
  'keeping the records again is harmless');
select is((select pg_temp.snapshot('10000000-0000-4000-8000-000000000001') || pg_temp.snapshot('10000000-0000-4000-8000-000000000005')),
  (select p01 || p05 from before_rerun), 'and changes nothing');
select is(kc_private.account_purge_finish('00000000-0000-4000-8000-00000000000a'), false, 'a second finish has nothing to do');

-- ── 5. Reads: the counterpart sees "no owner"; nobody sees her name ─────────
select is(pg_temp.read('b', 'select count(*) from public.posts where id = #01') || '/'
    || pg_temp.read('c', 'select count(*) from public.posts where id = #01'), '1/0',
  'only the counterpart reads a post of a deleted owner');
select is(pg_temp.read('b', $$select (d -> 'post' ->> 'owner_id') is null and (d -> 'post' ->> 'owner_display_name') is null
    and (d -> 'post' ->> 'owner_avatar_url') is null and (d -> 'post' ->> 'owner_share_handle') is null
    and (d -> 'post' ->> 'owner_identity_masked') = 'false' and (d -> 'post' ->> 'title') = '—'
    and jsonb_array_length(d -> 'media') = 0 from public.post_detail(#01) d$$), 'true',
  'Bob''s post detail: no owner, not masked, no photos');
select is(pg_temp.read('c', 'select count(*) from public.post_cards(array[#01])'), '0',
  'a stranger gets no card of it');
select is(pg_temp.read('c', $$select coalesce(owner_id::text, 'null') || '|' || owner_identity_masked || '|' || coalesce(owner_display_name, 'null')
    from public.post_cards(array[#07])$$), 'null|true|null',
  'a hidden-name post is masked: its NULL owner is not a deleted one');
select is(pg_temp.read('b', $$select kind || '|' || coalesce(actor_id::text, 'null') || '|' || coalesce(actor_display_name, 'null')
    from public.my_activity_timeline() where post_id = #01$$), 'marked_as_recipient|null|null',
  'Bob''s timeline names no giver');
select is(pg_temp.read('b', $$select jsonb_array_length(s -> 'posts') + jsonb_array_length(s -> 'users') from public.search_all('Zelda') s$$),
  '0', 'searching her name finds nothing');
select is(pg_temp.read('b', $$select count(*) from public.post_detail(#01) d where d::text like '%Zelda%'$$), '0',
  'no field of the kept post carries her name or her text');

-- ── 6. Guards do not open for a NULL member ─────────────────────────────────
select is(pg_temp.act('c', 'select public.rate_handoff(~h01, 5)') || ' ' || pg_temp.act('c', 'select public.rate_handoff(~h05, 5)'),
  'not_participant not_participant', 'a stranger cannot rate a handoff with a deleted side');
select is(pg_temp.act('b', 'select public.rate_handoff(~h01, 5)'), 'counterpart_deleted', 'nobody is left to rate');
select is(pg_temp.act('c', 'select public.mark_giving_handed_over(~h01)') || ' ' || pg_temp.act('c', 'select public.cancel_giving_handoff(~h05)'),
  'handoff_not_found handoff_not_found', 'a stranger cannot move such a handoff');
select is(pg_temp.act('c', $$select public.upsert_post_actor_identity(#01, 'Public', false)$$), 'not_participant',
  'a stranger cannot set an identity on a post with no owner');

-- ── 7. Deleted on both sides ────────────────────────────────────────────────
delete from auth.users where id = '00000000-0000-4000-8000-00000000000f';
select is(pg_temp.val($$select coalesce(owner_id::text, 'null') || '|' || title from public.posts where id = #06$$), 'null|—',
  'Fay''s post handed to Bob stays after Fay leaves');
select lives_ok($$delete from auth.users where id = '00000000-0000-4000-8000-00000000000b'$$,
  'then Bob leaves too: no constraint is violated');
select is(pg_temp.val('select count(*) from public.posts where id in (#01, #06)'), '0',
  'a record with nobody left is deleted');
select lives_ok($$update public.post_handoffs set owner_id = null where id = (select id from pg_temp.named_handoff where name = 'h05')$$,
  'a handoff whose two members are NULL satisfies its checks');

select * from finish();
rollback;
