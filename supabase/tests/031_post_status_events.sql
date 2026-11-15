-- The status history of a post (issue #2082, D142): one row per status change, whoever made
-- it, with the kernel role, the acting member and a reason code; a same-status write and an
-- insert leave no row; a date cancelled by its series says so; the owner reads the history of
-- their own posts only, nobody writes it, and it is deleted with its post.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- Runs a statement as an API role (signed in as the member with hex digit p_who, if given).
-- Returns 'ok', the message of a P0001 error, or the SQLSTATE of any other error.
create function pg_temp.act(p_role text, p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_sql constant text := regexp_replace(p_sql, '@([0-9a-f])', '''00000000-0000-4000-8000-00000000000\1''::uuid', 'g');
begin
  begin
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', '00000000-0000-4000-8000-00000000000' || p_who, 'role', p_role)::text, true);
    perform set_config('role', p_role, true);
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

-- One value read as a signed-in member, or as the database owner when p_who is null. Reads
-- that follow an action go through this function, so they run after it.
create function pg_temp.val(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_sql constant text := regexp_replace(p_sql, '@([0-9a-f])', '''00000000-0000-4000-8000-00000000000\1''::uuid', 'g');
  v_value text;
begin
  if p_who is not null then
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', '00000000-0000-4000-8000-00000000000' || p_who, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
  end if;
  execute v_sql into v_value;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '{}', true);
  return v_value;
end;
$$;

-- The history of the test post as "from>to/role/reason" entries, oldest first.
create function pg_temp.history()
returns text
language sql
as $$
  select pg_temp.val(null, $q$
    select string_agg(e.from_status || '>' || e.to_status || '/' || coalesce(e.role, '-') || '/' || coalesce(e.reason, '-'),
                      ' ' order by e.id)
      from public.post_status_events e where e.post_id = '10000000-0000-4000-8000-000000000001'$q$);
$$;

select plan(11);

-- a moderator · e the post owner · 1 another member.
insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'::jsonb
  from unnest(string_to_array('a,e,1', ',')) x;
insert into public.cities (city_id, name_he, name_en, location) values ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)');
insert into public.worlds (slug, label_he, label_en) values ('items', 'items', 'Items');
insert into public.post_kinds (id, world_slug, slug, label_he, label_en, direction) values
  ('20000000-0000-4000-8000-000000000001', 'items', 'item', 'item', 'Item', 'either');
insert into public.posts (id, owner_id, world_slug, kind_id, direction, status, title, city_id) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000e', 'items',
   '20000000-0000-4000-8000-000000000001', 'offer', 'open', 'post', 'c1');

-- ── What is recorded ────────────────────────────────────────────────────────
select is((select count(*) from public.post_status_events), 0::bigint, 'creating a post is not a status change');
select is(pg_temp.act('authenticated', 'e', $$select public.pause_post('10000000-0000-4000-8000-000000000001')$$)
  || pg_temp.act('authenticated', 'e', $$select public.resume_post('10000000-0000-4000-8000-000000000001')$$)
  || '|' || pg_temp.history(), 'okok|open>paused/owner/- paused>open/owner/-',
  'each move of the owner is one row, in the role that made it');
select is(pg_temp.val(null, $$select count(*) || '/' || count(*) filter (where actor_id = @e) from public.post_status_events$$),
  '2/2', 'the acting member is kept');
update public.posts set title = 'post, edited' where id = '10000000-0000-4000-8000-000000000001';
update public.posts set status = status where id = '10000000-0000-4000-8000-000000000001';
select is((select count(*) from public.post_status_events), 2::bigint, 'an edit and a same-status write leave no row');

-- A sweep moves the post as the system: no acting member, even inside a member's request.
update public.posts set expires_at = now() - interval '1 minute' where id = '10000000-0000-4000-8000-000000000001';
select ok(kc_private.post_expiry_sweep() >= 1, 'the expiry sweep closes the post');
select is(pg_temp.val(null, $$select e.from_status || '>' || e.to_status || '/' || e.role || '/' || (e.actor_id is null)
    from public.post_status_events e order by e.id desc limit 1$$), 'open>expired/system/true',
  'a system move is recorded without an acting member');

-- ── The reason ──────────────────────────────────────────────────────────────
-- The owner deletes the expired post; then a second post is cancelled by its series.
select is(pg_temp.act('authenticated', 'e', $$select public.delete_post('10000000-0000-4000-8000-000000000001')$$)
  || '|' || pg_temp.val(null, $$select e.to_status || '/' || coalesce(e.reason, '-') from public.post_status_events e order by e.id desc limit 1$$),
  'ok|deleted_no_recipient/-', 'a plain delete carries no reason');
insert into public.posts (id, owner_id, world_slug, kind_id, direction, status, title, city_id) values
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-00000000000e', 'items',
   '20000000-0000-4000-8000-000000000001', 'offer', 'open', 'a date of a series', 'c1');
do $$
begin
  perform kc_private.post_cancel_by_owner('10000000-0000-4000-8000-000000000002');
  -- The reason belongs to that move only: the next move does not inherit it.
  perform kc_private.post_move('10000000-0000-4000-8000-000000000002', 'open', 'owner');
end $$;
select is(pg_temp.val(null, $$select string_agg(e.to_status || '/' || coalesce(e.reason, '-'), ' ' order by e.id)
    from public.post_status_events e where e.post_id = '10000000-0000-4000-8000-000000000002'$$),
  'deleted_no_recipient/series_cancelled open/-', 'a date cancelled by its series says so, and only that move');

-- ── Access, and the end of the history ─────────────────────────────────────
select is(pg_temp.val('e', 'select count(*) from public.post_status_events')
  || '/' || pg_temp.val('1', 'select count(*) from public.post_status_events'), '6/0',
  'the owner reads the history of their posts; another member reads none');
select is(pg_temp.act('authenticated', 'e', $$insert into public.post_status_events (post_id, from_status, to_status)
      values ('10000000-0000-4000-8000-000000000001', 'open', 'paused')$$)
  || '|' || pg_temp.act('authenticated', 'e', 'update public.post_status_events set reason = null')
  || '|' || pg_temp.act('authenticated', 'e', 'delete from public.post_status_events'), '42501|42501|42501',
  'nobody writes the history through the API');
delete from public.posts where id = '10000000-0000-4000-8000-000000000001';
select is((select count(*) from public.post_status_events where post_id = '10000000-0000-4000-8000-000000000001'),
  0::bigint, 'the history is deleted with its post');

select * from finish();
rollback;
