-- Audit: the trail is written by one function, routed to monthly partitions, changed by
-- nobody — not the service role, not the owner — and leaves only by dropping old
-- partitions; state changes are recorded by trigger, outbox events by the consumer, and a
-- purged account leaves a tombstone while its audit rows stay.
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
    return case sqlstate when 'P0001' then sqlerrm else sqlstate end;
  end;
end;
$$;

-- Rows a signed-in member gets from a query.
create function pg_temp.seen(p_who text, p_sql text)
returns bigint
language plpgsql
as $$
declare
  v_sql constant text := regexp_replace(p_sql, '@([0-9a-f])', '''00000000-0000-4000-8000-00000000000\1''::uuid', 'g');
  v_rows bigint;
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', '00000000-0000-4000-8000-00000000000' || p_who, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute 'select count(*) from (' || v_sql || ') q' into v_rows;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '{}', true);
  return v_rows;
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
  execute regexp_replace(p_sql, '@([0-9a-f])', '''00000000-0000-4000-8000-00000000000\1''::uuid', 'g') into v_value;
  return v_value;
end;
$$;

-- The partition holding the newest event of an action.
create function pg_temp.partition_of(p_action text)
returns text
language sql
as $$
  select e.tableoid::regclass::text from audit.events e where e.action = p_action order by e.id desc limit 1;
$$;

select plan(40);

-- a super admin · b moderator · c support · e post owner · 1, 2 members.
insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'::jsonb
  from unnest(string_to_array('a,b,c,e,1,2', ',')) x;
insert into public.cities (city_id, name_he, name_en, location) values ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)');
insert into public.worlds (slug, label_he, label_en) values ('items', 'items', 'Items');
insert into public.post_kinds (id, world_slug, slug, label_he, label_en, direction) values
  ('20000000-0000-4000-8000-000000000001', 'items', 'item', 'item', 'Item', 'either');
insert into public.posts (id, owner_id, world_slug, kind_id, direction, status, title, city_id) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000e', 'items',
   '20000000-0000-4000-8000-000000000001', 'offer', 'open', 'post', 'c1');

-- ── Recording ───────────────────────────────────────────────────────────────
select is((select count(*) from audit.events), 0::bigint, 'sign-ups and plain content writes are not audited');
do $$ begin perform set_config('request.headers', '{"x-forwarded-for":"203.0.113.7, 10.0.0.1"}', true); end $$;
select is(pg_temp.act('service_role', 'a', $$select kc_private.audit_record('test_action', 'post', gen_random_uuid(), '{"post_id":"x"}')$$)
  || pg_temp.val($$select (actor_id = @a) || '/' || actor_role || '/' || host(request_ip) || '/' || (metadata ->> 'post_id')
       from audit.events where action = 'test_action'$$),
  'oktrue/service_role/203.0.113.7/x', 'an event carries its actor, target, metadata and request context');
do $$ begin perform set_config('request.headers', '', true); end $$;
select throws_ok($$select kc_private.audit_record('test_action', 'user', null, '{"phone":"0500000000"}')$$,
  '23514', null, 'metadata with a personal-data key is refused');
select throws_ok($$select kc_private.audit_record('Not An Action')$$, '23514', null, 'an action is a snake_case verb');
select is(pg_temp.act('authenticated', '1', $$select kc_private.audit_record('test_action')$$) || '|'
  || pg_temp.act('authenticated', '1', 'select 1 from audit.events') || '|'
  || pg_temp.act('anon', null, 'select 1 from audit.events'), '42501|42501|42501', 'members and signed-out callers cannot write or read the trail');

-- ── Nobody changes the trail ────────────────────────────────────────────────
select is(pg_temp.act('service_role', null, 'select 1 from audit.events') || '|'
  || pg_temp.act('service_role', null, $$insert into audit.events (action) values ('test_action')$$) || '|'
  || pg_temp.act('service_role', null, $$update audit.events set action = 'changed'$$) || '|'
  || pg_temp.act('service_role', null, 'delete from audit.events') || '|'
  || pg_temp.act('service_role', null, 'truncate audit.events') || '|'
  || pg_temp.act('service_role', null, 'delete from audit.events_default'),
  'ok|42501|42501|42501|42501|42501', 'the service role reads the trail and can do nothing else to it');
select throws_ok($$update audit.events set action = 'changed'$$, 'P0001', 'append_only', 'the owner cannot update an event');
select throws_ok('delete from audit.events', 'P0001', 'append_only', 'the owner cannot delete an event');
select throws_ok('truncate audit.events', 'P0001', 'append_only', 'the owner cannot truncate the trail');
select throws_ok(format('truncate %s', pg_temp.partition_of('test_action')), 'P0001', 'append_only',
  'the owner cannot truncate one partition');
select throws_ok('truncate audit.events_default', 'P0001', 'append_only', 'nor the default partition');
select throws_ok(format('delete from %s', pg_temp.partition_of('test_action')), 'P0001', 'append_only',
  'a partition addressed directly is as closed as the parent');
grant update, delete on audit.events to service_role;
select is(pg_temp.act('service_role', null, $$update audit.events set action = 'changed'$$) || '|'
  || pg_temp.act('service_role', null, 'delete from audit.events'), 'append_only|append_only',
  'even a role that was granted the privilege cannot change an event');
select is((select count(*) || '/' || min(action) from audit.events), '1/test_action', 'the trail is intact');

-- ── Monthly partitions ──────────────────────────────────────────────────────
select is(pg_temp.partition_of('test_action'), 'audit.events_' || to_char(now() at time zone 'UTC', '"y"YYYY"m"MM'),
  'an event goes to the partition of its month');
select is(kc_private.audit_ensure_partition(date '2020-01-15')::text || kc_private.audit_ensure_partition(date '2020-01-31')::text,
  'truefalse', 'a monthly partition is created once');
do $$
begin
  perform kc_private.audit_record('old_action', null, null, '{}', null, timestamptz '2020-01-20 12:00+00');
  perform kc_private.audit_record('older_action', null, null, '{}', null, timestamptz '2019-05-05 12:00+00');
end $$;
select is(pg_temp.partition_of('old_action') || ' ' || pg_temp.partition_of('older_action'),
  'audit.events_y2020m01 audit.events_default', 'an event of an unprepared month falls into the default partition');
select ok((select c.relrowsecurity and c.relforcerowsecurity
             and not has_table_privilege('service_role', c.oid, 'select')
             and not has_table_privilege('service_role', c.oid, 'delete')
             from pg_class c where c.oid = 'audit.events_y2020m01'::regclass),
  'a new partition is closed like the others');
select is(kc_private.audit_ensure_partition(date '2019-05-01')::text
  || (select count(*) from audit.events where action = 'older_action'), 'false1',
  'a month already held by the default partition stays there, rows intact');
select throws_ok('select kc_private.audit_drop_partitions_before(current_date)', 'P0001', 'retention_too_short',
  'retention never drops the last 24 months');
select is(kc_private.audit_drop_partitions_before(date '2020-06-01'), 1, 'retention drops whole old partitions');
select is((select string_agg(action, ',' order by action) from audit.events), 'older_action,test_action',
  'and nothing else');

-- ── State changes recorded by trigger ───────────────────────────────────────
insert into public.admin_role_grants (user_id, role) values
  ('00000000-0000-4000-8000-00000000000a', 'super_admin'), ('00000000-0000-4000-8000-00000000000b', 'moderator'),
  ('00000000-0000-4000-8000-00000000000c', 'support');
select is(pg_temp.val($$select count(*) || '/' || count(*) filter (where metadata ->> 'role' = 'moderator' and target_id = @b)
     from audit.events where action = 'admin_role_grant'$$), '3/1', 'a role grant written by anyone is audited');
update public.user_account set status = 'suspended_admin' where user_id = '00000000-0000-4000-8000-000000000002';
update public.user_account set onboarding_state = 'pending_avatar' where user_id = '00000000-0000-4000-8000-000000000002';
select is(pg_temp.val($$select count(*) || '/' || min(metadata ->> 'from') || '>' || min(metadata ->> 'to')
     from audit.events where action = 'account_status_changed' and target_id = @2$$), '1/active>suspended_admin',
  'an account status change is audited; other account writes are not');
select is(pg_temp.act('authenticated', 'e', $$select public.pause_post('10000000-0000-4000-8000-000000000001')$$)
  || pg_temp.act('authenticated', 'e', $$select public.resume_post('10000000-0000-4000-8000-000000000001')$$)
  || (select count(*) from audit.events where action = 'post_status_moderated'), 'okok0', 'owner moves of a post are not audited');
select is(pg_temp.act('authenticated', 'b', $$select public.admin_remove_post('10000000-0000-4000-8000-000000000001')$$)
  || pg_temp.val($$select (actor_id = @b) || '/' || (metadata ->> 'from') || '>' || (metadata ->> 'to') || '/' || (metadata ->> 'role')
       from audit.events where action = 'post_status_moderated'$$),
  'oktrue/open>removed_admin/admin', 'an admin move of a post is audited with its actor');
select is(pg_temp.act('authenticated', 'b', $$select public.admin_restore_post('10000000-0000-4000-8000-000000000001')$$), 'ok', 'the post is restored');
do $$
begin
  perform set_config('kc.fsm_role', 'system', true);
  update public.posts set status = 'hidden_pending_review' where id = '10000000-0000-4000-8000-000000000001';
  perform set_config('kc.fsm_role', '', true);
end $$;
select is(pg_temp.val($$select count(*) || '/' || count(actor_id) from audit.events
     where action = 'post_status_moderated' and metadata ->> 'to' = 'hidden_pending_review'$$), '1/0',
  'an automatic hide is audited without an actor');

-- ── Outbox topic `audit` ────────────────────────────────────────────────────
do $$
begin
  perform kc_private.outbox_enqueue('audit', jsonb_build_object(
    'action', 'post_private_location_released', 'actor_id', '00000000-0000-4000-8000-000000000001',
    'entity', jsonb_build_object('type', 'post', 'id', '10000000-0000-4000-8000-000000000001'),
    'data', jsonb_build_object('handoff_id', gen_random_uuid())));
  perform kc_private.outbox_enqueue('audit', '{"entity":{"type":"post"}}');
end $$;
select is(kc_private.audit_consume_outbox()::text
  || pg_temp.val($$select '/' || (e.actor_id = @1) || '/' || e.target_type || '/' || (e.metadata ? 'handoff_id')
         || '/' || (e.occurred_at = o.created_at)
       from audit.events e join kc_private.outbox_events o on o.payload ->> 'action' = e.action
      where e.action = 'post_private_location_released' and o.processed_at is not null$$),
  '1/true/post/true/true', 'a queued audit event becomes a row stamped with the time it happened');
select is((select count(*) || '/' || count(last_error) from kc_private.outbox_events where topic = 'audit' and processed_at is null),
  '1/1', 'an event that cannot be recorded is kept with its error');

-- ── The audit screen ────────────────────────────────────────────────────────
select is(pg_temp.seen('a', 'select 1 from public.admin_audit_search(p_limit => 200)'),
  (select count(*) from audit.events), 'the super admin searches the whole trail');
select is(pg_temp.seen('b', 'select 1 from public.admin_audit_search()') || '/' || pg_temp.seen('c', 'select 1 from public.admin_audit_search()'),
  (select count(*) from audit.events where '00000000-0000-4000-8000-00000000000b' in (actor_id, target_id)) || '/0',
  'a moderator sees events by or about themselves, support only their own');
select is(pg_temp.act('authenticated', '1', 'select 1 from public.admin_audit_search()'), '42501', 'a member cannot search the trail');
select is(pg_temp.seen('a', $$select 1 from public.admin_audit_search(p_action => 'admin_role_grant')$$) || '/'
  || pg_temp.seen('a', 'select 1 from public.admin_audit_search(p_target_id => @2)') || '/'
  || pg_temp.seen('a', $$select 1 from public.admin_audit_search(p_to => timestamptz '2020-01-01')$$), '3/1/1', 'the search filters by action, target and time');
select is(pg_temp.seen('a', $$with page1 as (select * from public.admin_audit_search(p_limit => 2)),
       cursor as (select occurred_at, id from page1 order by occurred_at, id limit 1),
       page2 as (select s.* from cursor c, public.admin_audit_search(
                   p_before_occurred_at => c.occurred_at, p_before_id => c.id, p_limit => 200) s)
     select 1 from page1 union all select 1 from page2 where id not in (select id from page1)$$),
  (select count(*) from audit.events), 'keyset pages cover the trail once, newest first');

-- ── Account purge: tombstone, and the trail survives ────────────────────────
select is(pg_temp.act('service_role', null, 'select 1 from kc_private.audit_tombstone_salt'), '42501',
  'the tombstone salt is closed to the service role');
update public.user_account set status = 'active' where user_id = '00000000-0000-4000-8000-000000000002';
select is(pg_temp.act('authenticated', '2', 'select public.request_account_deletion()'), 'ok', 'a member asks for deletion');
do $$
begin
  perform kc_private.audit_record_deletion('00000000-0000-4000-8000-000000000002');
  perform kc_private.audit_record_deletion('00000000-0000-4000-8000-000000000002');
end $$;
delete from auth.users where id = '00000000-0000-4000-8000-000000000002';
select is(pg_temp.val($$select count(*) || '/' || bool_and(user_hash = kc_private.audit_tombstone_hash(@2)) || '/' || (min(requested_at) is not null)
       || '/' || (select count(*) || '/' || count(target_id) || '/' || (min(metadata ->> 'tombstone') = encode(kc_private.audit_tombstone_hash(@2), 'hex'))
                    from audit.events where action = 'account_purged')
     from audit.deletion_tombstones$$), '1/true/true/1/0/true',
  'a purge leaves one tombstone — a salted hash and the dates — and an event that names no member');
select throws_ok('delete from audit.deletion_tombstones', 'P0001', 'append_only', 'a tombstone cannot be removed');
select is(pg_temp.val($$select (select count(*) from public.users where id = @2) || '/'
       || (select count(*) > 0 from audit.events where target_id = @2)$$), '0/true',
  'the member is gone and the events about them remain, as ids only');

select * from finish();
rollback;
