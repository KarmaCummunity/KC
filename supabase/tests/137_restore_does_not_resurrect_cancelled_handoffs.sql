-- Deleted user (#2088), FR-AUTH-016 AC3 exception: a member who asks to be deleted and then
-- restores the account during the grace period gets back the account, their posts and their
-- history, but not the live handoffs that were cancelled when they asked. The counterpart was
-- told and is free; they should not wait up to 30 days. Nothing of the purge's keep/scrub ran.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

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

select plan(12);

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- Ann (a) will leave and come back. Bob (b) has reserved Ann's post 01, Ann is confirmed on
-- Bob's post 02, and Ann already handed post 03 over to Bob. Carol (c) is a stranger.
insert into auth.users (id, email, raw_app_meta_data, email_confirmed_at)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}', now()
  from unnest(array['a', 'b', 'c']) x;
update public.users u set display_name = m.name from (values ('a', 'Ann Back'), ('b', 'Bob'), ('c', 'Carol')) m (who, name)
 where u.id = ('00000000-0000-4000-8000-00000000000' || m.who)::uuid;
insert into public.cities (city_id, name_he, name_en, location) values
  ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)');
insert into public.worlds (slug, label_he, label_en) values ('items', 'items', 'items');
insert into public.post_kinds (id, world_slug, slug, label_he, label_en, direction) values
  ('20000000-0000-4000-8000-000000000001', 'items', 'items_kind', 'items', 'items', 'either');
insert into public.posts (id, owner_id, world_slug, kind_id, direction, status, title, description, city_id)
select ('10000000-0000-4000-8000-0000000000' || n)::uuid, ('00000000-0000-4000-8000-00000000000' || o)::uuid,
       'items', '20000000-0000-4000-8000-000000000001', 'offer', 'open', 'post ' || n, 'about ' || n, 'c1'
  from (values ('01', 'a'), ('02', 'b'), ('03', 'a')) v (n, o);
insert into public.post_handoffs (post_id, recipient_id, status) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000b', 'reserved'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-00000000000a', 'confirmed'),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-00000000000b', 'confirmed');
insert into pg_temp.named_handoff (name, id)
select 'h' || right(h.post_id::text, 2), h.id from public.post_handoffs h;
select is(pg_temp.act('a', 'select public.mark_giving_handed_over(~h03)'), 'ok', 'Ann hands post 03 over to Bob');

-- ── Leave, then come back ───────────────────────────────────────────────────
select is(pg_temp.act('a', 'select public.request_account_deletion()'), 'ok', 'Ann asks to be deleted');
select is(pg_temp.val('select string_agg(status || ''/'' || coalesce(cancel_reason, ''-''), '','' order by post_id) from public.post_handoffs'),
  'cancelled/system,cancelled/system,handed_over/-', 'her live handoffs are cancelled, the handed-over one is not');
select is(pg_temp.act('a', 'select public.restore_account()'), 'ok', 'Ann restores her account in the grace period');
select is(pg_temp.val('select status from public.user_account where user_id = @a'), 'active', 'her account is active again');

-- The exception: cancelled live handoffs stay cancelled.
select is(pg_temp.val('select string_agg(status || ''/'' || coalesce(cancel_reason, ''-''), '','' order by post_id) from public.post_handoffs'),
  'cancelled/system,cancelled/system,handed_over/-', 'the cancelled handoffs are not brought back');
select is(pg_temp.val($$select count(*) from public.post_handoffs
    where (owner_id = @a or recipient_id = @a) and status in ('waitlisted', 'reserved', 'confirmed')$$), '0',
  'she has no live handoff after the restore');

-- Everything else comes back as it was.
select is(pg_temp.val($$select string_agg(right(id::text, 2) || ':' || right(owner_id::text, 1) || ':' || title || ':' || description,
    ',' order by id) from public.posts where owner_id = @a$$), '01:a:post 01:about 01,03:a:post 03:about 03',
  'her posts are back, owned by her, with their text');
select is(pg_temp.val($$select right(owner_id::text, 1) || '|' || right(recipient_id::text, 1) || '|' || status
    from public.post_handoffs where id = ~h03$$), 'a|b|handed_over', 'her handover history keeps both members');
select is(pg_temp.val('select items_given_count from public.user_stats where user_id = @a'), '1', 'her counters are intact');
select is(pg_temp.read('c', 'select count(*) from public.post_cards(array[#01, #03])'), '2',
  'others see her posts again');
select is(pg_temp.read('c', $$select count(*) from public.search_users_page('Ann')$$), '1', 'and find her by name');

select * from finish();
rollback;
