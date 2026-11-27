-- The account purge and in-flight photo jobs (KC#2316). Before the purge empties a member's
-- `derived/<owner>/` folder it calls kc_private.post_media_purge_hold: every queued job of the
-- member is skipped, every claimed one is cancelled (its completion and failure are refused from
-- then on, and it is never handed out again), and the answer says whether a cancelled job's lease
-- is still running. While it is, the purge defers the account, so the folder is emptied only once
-- no worker may still write into it. Other members' jobs are untouched.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

create function pg_temp.as_member(p_who text, p_sql text)
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  begin
    perform set_config('request.jwt.claims', jsonb_build_object(
      'sub', '00000000-0000-4000-8000-00000000000' || p_who, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    execute p_sql into v_value;
    perform set_config('role', 'none', true);
    return coalesce(v_value, 'ok');
  exception when others then
    perform set_config('role', 'none', true);
    return case when sqlstate in ('P0001', '42501') then sqlerrm else sqlstate end;
  end;
end;
$$;

-- Member `p_who` uploads `p_key` and records it on their post; returns the row id.
create function pg_temp.attach(p_who text, p_key text, p_ordinal integer)
returns uuid
language plpgsql
as $$
declare
  v_id uuid := gen_random_uuid();
  v_owner text := '00000000-0000-4000-8000-00000000000' || p_who;
begin
  insert into storage.objects (bucket_id, name, metadata)
  values ('post-images', v_owner || '/' || p_key, '{"mimetype":"image/jpeg","size":1000}');
  perform pg_temp.as_member(p_who, format($q$insert into public.post_media (id, post_id, owner_id, storage_key, ordinal, mime_type, size_bytes)
      values (%L, %L, %L, %L, %s, 'image/jpeg', 1000) returning 'ok'$q$,
      v_id, '40000000-0000-4000-8000-00000000000' || p_who, v_owner, v_owner || '/' || p_key, p_ordinal));
  return v_id;
end;
$$;

create function pg_temp.state(p_media uuid) returns text
language sql as $$ select state from kc_private.post_media_processing where media_id = p_media; $$;

select plan(9);

insert into auth.users (id, email, raw_app_meta_data)
select ('00000000-0000-4000-8000-00000000000' || x)::uuid, x || '@example.test', '{"provider":"google"}'
  from unnest(array['a', 'b']) x;
insert into public.cities (city_id, name_he, name_en, location) values ('c1', 'c1', 'City One', 'SRID=4326;POINT(34.78 32.08)');
insert into public.worlds (slug, label_he, label_en) values ('items', 'items', 'items');
insert into public.post_kinds (id, world_slug, slug, label_he, label_en, direction)
values ('20000000-0000-4000-8000-000000000001', 'items', 'item', 'item', 'item', 'either');
insert into public.posts (id, owner_id, world_slug, kind_id, direction, status, visibility, title, city_id)
select ('40000000-0000-4000-8000-00000000000' || x)::uuid, ('00000000-0000-4000-8000-00000000000' || x)::uuid, 'items',
       '20000000-0000-4000-8000-000000000001', 'request', 'open', 'Public', 'post ' || x, 'c1'
  from unnest(array['a', 'b']) x;

create temp table t (name text primary key, id uuid);
insert into t values ('a_claimed', pg_temp.attach('a', 'b1/0.jpg', 0));
create temp table c as select * from public.post_media_processing_claim(1, 300);
insert into t values ('a_queued', pg_temp.attach('a', 'b1/1.jpg', 1));
insert into t values ('b_queued', pg_temp.attach('b', 'b1/0.jpg', 0));

select is((select media_id from c), (select id from t where name = 'a_claimed'), 'one of Alice''s photos is being processed');
select is(kc_private.post_media_purge_hold('00000000-0000-4000-8000-00000000000a'), true,
  'the purge must wait: a cancelled job''s lease is still running');
select is(pg_temp.state((select id from t where name = 'a_claimed')) || '|' || pg_temp.state((select id from t where name = 'a_queued'))
    || '|' || pg_temp.state((select id from t where name = 'b_queued')),
  'cancelled|skipped|queued', 'Alice''s claimed job is cancelled, her queued one skipped; Bob''s is untouched');

-- The cancelled worker can no longer complete, fail, or get its job back.
insert into storage.objects (bucket_id, name, metadata)
values ('post-images', kc_private.post_media_derivative_key('00000000-0000-4000-8000-00000000000a', (select media_id from c), 1),
        '{"mimetype":"image/jpeg","size":"500"}');
select is(public.post_media_processing_complete((select media_id from c), (select lease_token from c),
    kc_private.post_media_derivative_key('00000000-0000-4000-8000-00000000000a', (select media_id from c), 1), 500, 10, 10),
  'stale', 'a cancelled job''s completion is refused');
select is(public.post_media_processing_fail((select media_id from c), (select lease_token from c), 'x', true),
  'stale', 'and so is its failure');
select is((select string_agg(media_id::text, ',') from public.post_media_processing_claim(10, 300)),
  (select id::text from t where name = 'b_queued'), 'only Bob''s job is handed out; Alice''s never again');
select is((select processing_status from public.post_media where id = (select id from t where name = 'a_claimed')),
  'pending', 'the cancelled row stays pending (never shown to others)');

-- Once the cancelled lease has run out, no worker may still write: the purge may proceed.
update kc_private.post_media_processing set leased_until = now() - interval '1 second'
 where media_id = (select media_id from c);
select is(kc_private.post_media_purge_hold('00000000-0000-4000-8000-00000000000a'), false,
  'after the lease ran out the purge may empty the folder');

select is(pg_temp.as_member('a', $$select kc_private.post_media_purge_hold('00000000-0000-4000-8000-00000000000a')::text$$),
  'permission denied for schema kc_private', 'no member can call the hold');

select * from finish();
rollback;
