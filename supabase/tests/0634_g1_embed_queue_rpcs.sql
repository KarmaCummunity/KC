-- supabase/tests/0634_g1_embed_queue_rpcs.sql | 0634 (G1 step 6a-6b, issue #1671): the embed
-- worker's three service-role RPCs.
--   1. embedding_jobs_claim takes the oldest pending jobs (FOR UPDATE SKIP LOCKED), marks them
--      processing and counts the attempt; a second claim does not return a job already taken;
--   2. embedding_job_store writes post_embeddings for a post-owned listing and the listing's
--      columns for a listing-sourced listing and an items listing, and closes the job;
--   3. a job the listings trigger re-queued since the claim stays pending (store and fail alike);
--   4. embedding_job_fail marks the job failed with its error;
--   5. clients can call none of them.
-- Runs in a rolled-back transaction.

begin;

create temp table personas as
select kc_test.create_user('emb_owner') as owner;

-- Jobs committed by earlier test files would be claimed first: set them aside for this run.
update public.embedding_jobs set status = 'done' where status in ('pending', 'processing');

/** A test vector (1536 dimensions, as the column). */
create function pg_temp.vec(p_value real)
returns extensions.vector
language sql
immutable
as $$ select array_fill(p_value, array[1536])::extensions.vector $$;

create function pg_temp.job_of(p_listing uuid)
returns public.embedding_jobs
language sql
as $$ select j from public.embedding_jobs j where j.listing_id = p_listing $$;

create temp table shapes (name text primary key, listing_id uuid);

-- ── Fixture: a post-owned ride, a listing-sourced ride and an items listing, each queued ──────
do $$
declare
  p personas;
  v_post uuid;
begin
  select * into p from personas;
  perform kc_test.act_as(p.owner);
  insert into shapes values ('owned', public.create_marketplace_listing(
    p_kind_id => kc_test.listing_kind_id('rides', 'ride_offer'), p_title => 'Tel Aviv to Jerusalem',
    p_details => kc_test.ride_route_tlv_jlm()
                 || jsonb_build_object('departs_at', kc_test.iso_in(interval '3 hours'), 'seats_available', 3),
    p_city_id => 'tel-aviv'));
  insert into shapes values ('direct', kc_test.create_ride_offer(p.owner));
  perform kc_test.act_as(p.owner);
  insert into public.posts (owner_id, type, title, category, city, street, street_number, item_condition)
  values (p.owner, 'Give', 'a bookshelf', 'Furniture', 'tel-aviv', 'Herzl', '1', 'Good')
  returning post_id into v_post;
  insert into shapes select 'items', listing_id from public.listings where legacy_post_id = v_post;
  perform kc_test.assert_row_count(
    'select 1 from public.embedding_jobs j join shapes s using (listing_id) where j.status = ''pending''', 3,
    'every shape is queued');
end $$;

-- ── T1 claim: oldest pending first, processing, attempt counted, never twice ─────────────────
do $$
declare
  v_n int;
  r record;
begin
  perform kc_test.assert_true(
    position('for update skip locked' in lower(pg_get_functiondef('public.embedding_jobs_claim(int)'::regprocedure))) > 0,
    'the claim skips jobs another run has locked');
  select count(*) into v_n from public.embedding_jobs_claim(2);
  perform kc_test.assert_eq(v_n, 2, 'the claim honours its limit');
  for r in select * from public.embedding_jobs_claim(10) loop
    perform kc_test.assert_eq((pg_temp.job_of(r.listing_id)).status, 'processing', 'a claimed job is processing');
    perform kc_test.assert_eq(r.title, (select title from public.listings where listing_id = r.listing_id),
      'the claim returns the listing''s text');
  end loop;
  perform kc_test.assert_row_count('select 1 from public.embedding_jobs_claim(10)', 0,
    'nothing is left to claim: a job is never returned twice');
  perform kc_test.assert_row_count(
    'select 1 from public.embedding_jobs j join shapes s using (listing_id) where j.status = ''processing'' and j.attempts = 1', 3,
    'every job was claimed once, its attempt counted');
end $$;

-- ── T2 store: the post's embedding for a post-owned listing, the listing's for the others ────
do $$
declare
  v_owned uuid := (select listing_id from shapes where name = 'owned');
  v_direct uuid := (select listing_id from shapes where name = 'direct');
  v_items uuid := (select listing_id from shapes where name = 'items');
  v_post uuid := (select legacy_post_id from public.listings where listing_id = v_owned);
begin
  perform kc_test.assert_true(public.embedding_job_store((pg_temp.job_of(v_owned)).job_id, pg_temp.vec(0.1), 'm1'),
    'storing closes the job');
  perform kc_test.assert_eq((select embedding_model from public.post_embeddings where post_id = v_post), 'm1',
    'a post-owned listing''s embedding is stored on its post');
  perform kc_test.assert_eq((select embedding from public.listings where listing_id = v_owned), null::extensions.vector,
    'and not on the listing');
  perform kc_test.assert_eq((pg_temp.job_of(v_owned)).status, 'done', 'the job is done');

  perform public.embedding_job_store((pg_temp.job_of(v_direct)).job_id, pg_temp.vec(0.2), 'm2');
  perform kc_test.assert_eq((select embedding_model from public.listings where listing_id = v_direct), 'm2',
    'a listing-sourced listing''s embedding is stored on the listing');
  perform kc_test.assert_row_count(
    format('select 1 from public.post_embeddings where post_id = %L', public.post_id_of_listing(v_direct)), 0,
    'and not on its mirror post');

  perform public.embedding_job_store((pg_temp.job_of(v_items)).job_id, pg_temp.vec(0.3), 'm3');
  perform kc_test.assert_eq((select embedding_model from public.listings where listing_id = v_items), 'm3',
    'an items listing''s embedding is stored on the listing');
  perform kc_test.assert_eq(
    (select public.listing_embedding_of(l) from public.listings l where l.listing_id = v_owned), pg_temp.vec(0.1),
    'the post-owned listing ranks on what was stored (0633)');

  perform kc_test.assert_raises(format('select public.embedding_job_store(%L, %L, %L)', gen_random_uuid(), pg_temp.vec(0.1), 'm'),
    'embedding_job_not_found', 'an unknown job is refused');
end $$;

-- ── T3 a job re-queued since the claim stays pending ──────────────────────────────────────────
do $$
declare
  p personas;
  v_owned uuid := (select listing_id from shapes where name = 'owned');
  v_direct uuid := (select listing_id from shapes where name = 'direct');
begin
  select * into p from personas;
  -- The owner edits both after the trigger queued them and a run claimed them.
  perform kc_test.act_as(p.owner);
  perform public.update_my_listing(v_owned, p_title => 'Tel Aviv to Jerusalem, edited');
  perform public.update_my_listing(v_direct, p_title => 'Tel Aviv to Jerusalem, direct');
  perform kc_test.assert_row_count('select 1 from public.embedding_jobs_claim(10)', 2, 'both edits were queued and claimed');
  perform public.update_my_listing(v_owned, p_title => 'Tel Aviv to Jerusalem, edited again');
  perform public.update_my_listing(v_direct, p_title => 'Tel Aviv to Jerusalem, direct again');
  perform kc_test.assert_eq((pg_temp.job_of(v_owned)).status, 'pending', 'a later edit re-queues a processing job');

  perform kc_test.assert_true(not public.embedding_job_store((pg_temp.job_of(v_owned)).job_id, pg_temp.vec(0.4), 'm4'),
    'storing a re-queued job does not close it');
  perform kc_test.assert_eq((pg_temp.job_of(v_owned)).status, 'pending', 'it stays pending for the changed text');
  perform public.embedding_job_fail((pg_temp.job_of(v_direct)).job_id, 'too late');
  perform kc_test.assert_eq((pg_temp.job_of(v_direct)).status, 'pending', 'a failure does not close a re-queued job either');
  perform kc_test.assert_eq((pg_temp.job_of(v_direct)).error_message, null::text, 'and records no error on it');
end $$;

-- ── T4 fail: failed, with its error ───────────────────────────────────────────────────────────
do $$
declare
  v_items uuid := (select listing_id from shapes where name = 'items');
  j public.embedding_jobs;
begin
  update public.listings set title = 'a bookshelf, oak' where listing_id = v_items; -- re-queues it
  perform kc_test.assert_row_count(format('select 1 from public.embedding_jobs_claim(10) where listing_id = %L', v_items), 1,
    'the items job is claimed');
  perform public.embedding_job_fail((pg_temp.job_of(v_items)).job_id, 'provider down');
  j := pg_temp.job_of(v_items);
  perform kc_test.assert_eq(j.status, 'failed', 'a failed job is marked failed');
  perform kc_test.assert_eq(j.error_message, 'provider down', 'with its error');
  perform kc_test.assert_eq(j.attempts, 1, 'the claim counted the attempt');
  perform kc_test.assert_row_count(format('select 1 from public.embedding_jobs_claim(10) where listing_id = %L', v_items), 0,
    'a failed job is not claimed again');
end $$;

-- ── T5 clients can call none of them ──────────────────────────────────────────────────────────
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.embedding_jobs_claim(int)',
    'public.embedding_job_store(uuid, extensions.vector, text)',
    'public.embedding_job_fail(uuid, text)'
  ] loop
    perform kc_test.assert_true(not has_function_privilege('authenticated', v_fn, 'execute'), v_fn || ': members cannot call it');
    perform kc_test.assert_true(not has_function_privilege('anon', v_fn, 'execute'), v_fn || ': guests cannot call it');
    perform kc_test.assert_true(has_function_privilege('service_role', v_fn, 'execute'), v_fn || ': the worker can');
  end loop;
end $$;

rollback;
\echo '✓ 0634_g1_embed_queue_rpcs.sql passed'
