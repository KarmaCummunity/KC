-- Sanitized post-photo derivatives (KC#2316): only new rows are queued; a claim leases a few jobs;
-- completion is a compare-and-set fenced by the lease, the row, the post's state and the stored
-- object; readers then see only the derivative; failures retry to a cap; the entry points are
-- service-role only; storage reconciliation keeps originals and thumbs that rows still need.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

-- A statement as a member ('a' / 'b') or signed out (null): its one value as text, the P0001 /
-- 42501 message, or the SQLSTATE.
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

-- The error message of a statement run as the server (service role code path), or 'ok'.
create function pg_temp.err(p_sql text)
returns text
language plpgsql
as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlerrm;
end;
$$;

-- What the storage service records for an object of Alice's.
create function pg_temp.stored(p_key text, p_mime text, p_size bigint)
returns void
language sql
as $$
  insert into storage.objects (bucket_id, name, metadata)
  values ('post-images', '00000000-0000-4000-8000-00000000000a/' || p_key,
          jsonb_build_object('mimetype', p_mime, 'size', p_size));
$$;

-- Alice records one photo on a post, as the app does after the upload; returns the row id.
create function pg_temp.attach(p_post text, p_key text, p_ordinal integer)
returns uuid
language plpgsql
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  perform pg_temp.stored(p_key, 'image/jpeg', 1000);
  perform pg_temp.as_member('a', format($q$insert into public.post_media (id, post_id, owner_id, storage_key, ordinal, mime_type, size_bytes)
      values (%L, %L, '00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000a/' || %L, %s, 'image/jpeg', 1000)
      returning 'ok'$q$, v_id, p_post, p_key, p_ordinal));
  return v_id;
end;
$$;

create function pg_temp.job(p_media uuid) returns kc_private.post_media_processing
language sql as $$ select * from kc_private.post_media_processing where media_id = p_media; $$;

-- Read in its own snapshot (a volatile function), so it sees what an earlier call in the same statement wrote.
create function pg_temp.status(p_media uuid) returns text
language sql as $$ select processing_status from public.post_media where id = p_media; $$;

create function pg_temp.derivative(p_media uuid, p_attempt integer) returns text
language sql as $$ select kc_private.post_media_derivative_key('00000000-0000-4000-8000-00000000000a', p_media, p_attempt); $$;

select plan(29);

insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b']) x;
insert into public.cities (city_id, name_he, name_en, location) values ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)');
insert into public.worlds (slug, label_he, label_en) values ('items', 'items', 'items');
insert into public.post_kinds (id, world_slug, slug, label_he, label_en, direction)
values ('20000000-0000-4000-8000-000000000001', 'items', 'item', 'item', 'item', 'either');
insert into public.posts (id, owner_id, world_slug, kind_id, direction, status, visibility, title, city_id)
select ('40000000-0000-4000-8000-00000000000' || n)::uuid, '00000000-0000-4000-8000-00000000000a', 'items',
       '20000000-0000-4000-8000-000000000001', 'request', 'open', 'Public', 'post ' || n, 'c1'
  from generate_series(1, 4) n;

-- ── Queue: new rows only ──────────────────────────────────────────────────────────────────────
create temp table t (name text primary key, id uuid);
insert into t values ('photo', pg_temp.attach('40000000-0000-4000-8000-000000000001', 'b1/0.jpg', 0));
select is((pg_temp.job((select id from t where name = 'photo'))).state || '|' || (pg_temp.job((select id from t where name = 'photo'))).source_key,
  'queued|00000000-0000-4000-8000-00000000000a/b1/0.jpg', 'a new member photo is queued with its original key');

-- A row that existed before the queue (simulated: its job removed) is never claimed: no sweep.
insert into t values ('legacy', pg_temp.attach('40000000-0000-4000-8000-000000000002', 'old/0.jpg', 0));
delete from kc_private.post_media_processing where media_id = (select id from t where name = 'legacy');
insert into public.post_media (post_id, owner_id, storage_key, ordinal, mime_type, size_bytes, processing_status)
values ('40000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000a/seed/1.jpg', 1, 'image/jpeg', 10, 'ready');
select is((select count(*)::text from kc_private.post_media_processing
            where media_id in (select id from t where name = 'legacy')
               or media_id in (select id from public.post_media where storage_key like '%/seed/1.jpg')),
  '0', 'rows already there and rows inserted ready are not queued');

-- ── Claim: bounded, leased, never handed out twice ───────────────────────────────────────────
create temp table c as select * from public.post_media_processing_claim(1, 300);
select is((select count(*)::text || '|' || min(attempt) || '|' || min(object_size) || '|' || min(object_mimetype) from c),
  '1|1|1000|image/jpeg', 'a claim returns at most p_limit jobs, attempt 1, with the stored size and type');
select is((select count(*)::text from public.post_media_processing_claim(10, 300)), '0',
  'a leased job is not handed out again while its lease runs');

-- ── Complete: compare-and-set and the storage fence ──────────────────────────────────────────
select is(public.post_media_processing_complete((select media_id from c), gen_random_uuid(),
    pg_temp.derivative((select media_id from c), 1), 900, 640, 480), 'stale', 'another lease token changes nothing');
select is(pg_temp.err(format('select public.post_media_processing_complete(%L, %L, %L, 900, 640, 480)',
    (select media_id from c), (select lease_token from c), '00000000-0000-4000-8000-00000000000a/b1/0.jpg')),
  'derivative_key_mismatch', 'the original key (or any other key) is refused as a derivative');
select is(pg_temp.err(format('select public.post_media_processing_complete(%L, %L, %L, 900, 640, 480)',
    (select media_id from c), (select lease_token from c), pg_temp.derivative((select media_id from c), 1))),
  'derivative_not_stored', 'a derivative Storage does not hold is refused (a DB lease is not a storage fence)');
select pg_temp.stored('derived/' || (select media_id from c) || '-a1.jpg', 'image/jpeg', 901);
select is(pg_temp.err(format('select public.post_media_processing_complete(%L, %L, %L, 900, 640, 480)',
    (select media_id from c), (select lease_token from c), pg_temp.derivative((select media_id from c), 1))),
  'derivative_not_stored', 'a stored object of another size is refused');
update storage.objects set metadata = jsonb_build_object('mimetype', 'image/jpeg', 'size', 900)
 where name = pg_temp.derivative((select media_id from c), 1);
select is(public.post_media_processing_complete((select media_id from c), (select lease_token from c),
    pg_temp.derivative((select media_id from c), 1), 900, 640, 480), 'ready', 'the attempt holding the lease completes');
select is((select processing_status || '|' || storage_key || '|' || size_bytes || '|' || width || 'x' || height
             from public.post_media where id = (select media_id from c)),
  'ready|' || pg_temp.derivative((select media_id from c), 1) || '|900|640x480', 'the row now points at the derivative');
select is(current_setting('kc.fsm_role', true), '', 'the system role is not left set');
select is(public.post_media_processing_complete((select media_id from c), (select lease_token from c),
    pg_temp.derivative((select media_id from c), 1), 900, 640, 480), 'stale', 'a second completion is stale');

-- ── Readers serve only the derivative ────────────────────────────────────────────────────────
select is(pg_temp.as_member('b', $$select string_agg(storage_key, ',') from public.post_media
                                    where post_id = '40000000-0000-4000-8000-000000000001'$$),
  pg_temp.derivative((select media_id from c), 1), 'another member reads the derivative key, never the original');
select is(pg_temp.as_member('b', $$select cover_media ->> 'storage_key'
      from public.post_cards(array['40000000-0000-4000-8000-000000000001'::uuid])$$),
  pg_temp.derivative((select media_id from c), 1), 'the feed card cover is the derivative');
select is(pg_temp.as_member(null, $$select cover_key from public.post_share_card('40000000-0000-4000-8000-000000000001')$$),
  pg_temp.derivative((select media_id from c), 1), 'the link-preview card names the derivative');
select is(pg_temp.as_member('b', $$select count(*)::text from kc_private.post_media_processing$$),
  'permission denied for schema kc_private', 'no member can read the queue (where the original key is kept)');

-- ── Lifecycle fences ─────────────────────────────────────────────────────────────────────────
insert into t values ('hidden', pg_temp.attach('40000000-0000-4000-8000-000000000003', 'b3/0.jpg', 0));
create temp table c3 as select * from public.post_media_processing_claim(10, 300);
set local "kc.fsm_role" = 'system';
update public.posts set status = 'hidden_pending_review' where id = '40000000-0000-4000-8000-000000000003';
set local "kc.fsm_role" = '';
select pg_temp.stored('derived/' || (select id from t where name = 'hidden') || '-a1.jpg', 'image/jpeg', 50);
select is(public.post_media_processing_complete((select id from t where name = 'hidden'), (select lease_token from c3),
    pg_temp.derivative((select id from t where name = 'hidden'), 1), 50, 10, 10)
    || '|' || pg_temp.status((select id from t where name = 'hidden'))
    || '|' || (pg_temp.job((select id from t where name = 'hidden'))).state,
  'changed|pending|skipped', 'a post hidden meanwhile: no completion, the job is skipped');

insert into t values ('deleted', pg_temp.attach('40000000-0000-4000-8000-000000000004', 'b4/0.jpg', 0));
create temp table c4 as select * from public.post_media_processing_claim(10, 300);
delete from public.posts where id = '40000000-0000-4000-8000-000000000004';
select is(public.post_media_processing_complete((select id from t where name = 'deleted'), (select lease_token from c4),
    pg_temp.derivative((select id from t where name = 'deleted'), 1), 50, 10, 10),
  'stale', 'a deleted post takes its row and job with it: completion is stale');

-- A job whose post stopped being showable before its claim is skipped, not handed out.
insert into t values ('late_hidden', pg_temp.attach('40000000-0000-4000-8000-000000000002', 'b2/2.jpg', 2));
set local "kc.fsm_role" = 'system';
update public.posts set status = 'hidden_pending_review' where id = '40000000-0000-4000-8000-000000000002';
set local "kc.fsm_role" = '';
select is((select count(*)::text from public.post_media_processing_claim(10, 300))
    || '|' || (pg_temp.job((select id from t where name = 'late_hidden'))).state,
  '0|skipped', 'a job of a hidden post is skipped at claim time');

-- ── Retries, lease expiry and the cap ────────────────────────────────────────────────────────
insert into public.posts (id, owner_id, world_slug, kind_id, direction, status, visibility, title, city_id)
values ('40000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-00000000000a', 'items',
        '20000000-0000-4000-8000-000000000001', 'request', 'open', 'Public', 'post 5', 'c1');
insert into t values ('flaky', pg_temp.attach('40000000-0000-4000-8000-000000000005', 'b5/0.jpg', 0));
create temp table r1 as select * from public.post_media_processing_claim(10, 300);
select is(public.post_media_processing_fail((select id from t where name = 'flaky'), (select lease_token from r1), 'download timed out', true)
    || '|' || ((pg_temp.job((select id from t where name = 'flaky'))).next_attempt_at > now() + interval '4 minutes')::text,
  'retry|true', 'a retryable failure waits (back-off) before the next attempt');
select is((select count(*)::text from public.post_media_processing_claim(10, 300)), '0', 'not handed out before it is due');
update kc_private.post_media_processing set next_attempt_at = now() - interval '1 second' where media_id = (select id from t where name = 'flaky');
create temp table r2 as select * from public.post_media_processing_claim(10, 300);
-- The worker of attempt 2 goes silent: its lease runs out and attempt 3 takes over with a new token.
update kc_private.post_media_processing set leased_until = now() - interval '1 second' where media_id = (select id from t where name = 'flaky');
create temp table r3 as select * from public.post_media_processing_claim(10, 300);
select is((select attempt::text from r3) || '|' || ((select lease_token from r3) <> (select lease_token from r2))::text,
  '3|true', 'an expired lease is handed out again as the next attempt, with a new token');
select is(public.post_media_processing_fail((select id from t where name = 'flaky'), (select lease_token from r2), 'late', true),
  'stale', 'the silent worker of attempt 2 can no longer record anything');
select is(public.post_media_processing_fail((select id from t where name = 'flaky'), (select lease_token from r3), 'decode failed', true)
    || '|' || pg_temp.status((select id from t where name = 'flaky')),
  'failed|failed', 'the third failure fails the job and the row (terminal)');
select is(pg_temp.as_member('b', $$select count(*)::text from public.post_media where post_id = '40000000-0000-4000-8000-000000000005'$$),
  '0', 'a failed photo is never shown to others');

-- A non-retryable failure fails at once.
insert into t values ('bad', pg_temp.attach('40000000-0000-4000-8000-000000000005', 'b5/1.jpg', 1));
create temp table b1 as select * from public.post_media_processing_claim(10, 300);
select is(public.post_media_processing_fail((select id from t where name = 'bad'), (select lease_token from b1), 'not_an_image', false),
  'failed', 'a non-retryable failure is terminal on the first attempt');

-- ── Service-role only ────────────────────────────────────────────────────────────────────────
select is((select string_agg(r || ':' || has_function_privilege(r, f, 'execute')::text, ',' order by r, f)
             from unnest(array['anon', 'authenticated']) r,
                  unnest(array['public.post_media_processing_claim(integer,integer)',
                               'public.post_media_processing_complete(uuid,uuid,text,bigint,integer,integer)',
                               'public.post_media_processing_fail(uuid,uuid,text,boolean)']) f),
  'anon:false,anon:false,anon:false,authenticated:false,authenticated:false,authenticated:false',
  'no client role may call the worker functions');
select ok(has_function_privilege('service_role', 'public.post_media_processing_claim(integer,integer)', 'execute'),
  'the service role may');

-- ── Storage reconciliation keeps what rows still need ────────────────────────────────────────
select is((select coalesce(string_agg(k, ',' order by k), '') from kc_private.storage_orphan_keys('post-images', array[
    '00000000-0000-4000-8000-00000000000a/b1/0.jpg',
    '00000000-0000-4000-8000-00000000000a/b1/0-thumb.jpg',
    pg_temp.derivative((select media_id from c), 1),
    replace(pg_temp.derivative((select media_id from c), 1), '.jpg', '-thumb.jpg'),
    '00000000-0000-4000-8000-00000000000a/b5/1-thumb.jpg',
    '00000000-0000-4000-8000-00000000000a/stray/9.jpg']) k),
  '00000000-0000-4000-8000-00000000000a/stray/9.jpg',
  'originals, derivatives and their thumbs are kept; only an unreferenced object is an orphan');

select * from finish();
rollback;
