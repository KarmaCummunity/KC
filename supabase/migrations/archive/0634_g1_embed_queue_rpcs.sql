-- 0634_g1_embed_queue_rpcs | G1 step 6a-6b (ADR-006, D-214, issue #1671): the embed worker works
-- through three service-role RPCs, and a post-owned listing's embedding is stored on its post.
--
-- The queue stays as 0244 built it: embedding_jobs is keyed by listing_id and the
-- listings_enqueue_embedding trigger re-queues a published listing whose title, summary or details
-- change (status back to 'pending', attempts 0); both stay until 6c. Until now the worker read the
-- pending jobs, then wrote each listing and job row by row, so two runs could take the same job.
--   1. embedding_jobs_claim(p_limit)  takes the oldest pending jobs with FOR UPDATE SKIP LOCKED,
--      marks them 'processing', counts the attempt, and returns each with the listing's title,
--      summary and details and the job's model; the worker builds the text to embed from them
--      exactly as before (JSON.stringify of the details is the worker's, so it stays there)
--   2. embedding_job_store(p_job_id, p_embedding, p_model)  stores the vector where the listing
--      ranks from it (listing_embedding_of, 0633): post_embeddings for a post-owned listing (origin
--      'native' with legacy_post_id), the listing's columns for every other shape; then marks the
--      job 'done', unless the trigger re-queued it since the claim ('pending'), which stays pending
--      so the changed text is embedded on the next run. Returns whether the job was closed.
--   3. embedding_job_fail(p_job_id, p_error)  the worker's failure path: 'failed' with the message
--      (the attempt was counted by the claim); a job re-queued since the claim stays pending.
-- All three are service_role only (0520). The embedder itself is still the stub (TD-269).

begin;

-- ── 1. Claim ────────────────────────────────────────────────────────────────────────────────────
create or replace function public.embedding_jobs_claim(p_limit int default 20)
returns table (
  job_id     uuid,
  listing_id uuid,
  model      text,
  title      text,
  summary    text,
  details    jsonb
)
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  return query
  with picked as (
    select j.job_id
      from public.embedding_jobs j
     where j.status = 'pending'
     order by j.created_at, j.job_id
     limit least(greatest(coalesce(p_limit, 20), 1), 50)
     for update skip locked
  ),
  claimed as (
    update public.embedding_jobs j
       set status = 'processing', attempts = j.attempts + 1
      from picked
     where j.job_id = picked.job_id
    returning j.job_id, j.listing_id, j.model, j.created_at
  )
  select c.job_id, c.listing_id, c.model, l.title, l.summary, l.details
    from claimed c
    join public.listings l on l.listing_id = c.listing_id
   order by c.created_at, c.job_id;
end;
$$;

comment on function public.embedding_jobs_claim(int) is
  'G1 (0634): claims up to p_limit (1–50) pending embedding jobs (FOR UPDATE SKIP LOCKED, status processing, attempt counted) and returns the listing text fields the embed worker embeds. service_role only.';

revoke all on function public.embedding_jobs_claim(int) from public, anon, authenticated;
grant execute on function public.embedding_jobs_claim(int) to service_role;

-- ── 2. Store ────────────────────────────────────────────────────────────────────────────────────
create or replace function public.embedding_job_store(p_job_id uuid, p_embedding extensions.vector, p_model text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_listing public.listings;
  v_closed int;
begin
  select l.* into v_listing
    from public.embedding_jobs j
    join public.listings l on l.listing_id = j.listing_id
   where j.job_id = p_job_id;
  if not found then
    raise exception 'embedding_job_not_found' using errcode = 'P0002';
  end if;

  -- Where the listing ranks from (listing_embedding_of, 0633).
  if v_listing.origin = 'native' and v_listing.legacy_post_id is not null then
    insert into public.post_embeddings as e (post_id, embedding, embedding_model)
    values (v_listing.legacy_post_id, p_embedding, p_model)
    on conflict (post_id) do update
      set embedding = excluded.embedding, embedding_model = excluded.embedding_model;
  else
    update public.listings
       set embedding = p_embedding, embedding_model = p_model
     where listing_id = v_listing.listing_id;
  end if;

  -- A job the trigger re-queued since the claim stays pending: its text changed.
  update public.embedding_jobs
     set status = 'done', error_message = null
   where job_id = p_job_id
     and status = 'processing';
  get diagnostics v_closed = row_count;
  return v_closed > 0;
end;
$$;

comment on function public.embedding_job_store(uuid, extensions.vector, text) is
  'G1 (0634): stores a claimed job''s embedding (post_embeddings for a post-owned listing, the listing otherwise) and closes the job unless it was re-queued since the claim. service_role only.';

revoke all on function public.embedding_job_store(uuid, extensions.vector, text) from public, anon, authenticated;
grant execute on function public.embedding_job_store(uuid, extensions.vector, text) to service_role;

-- ── 3. Fail ─────────────────────────────────────────────────────────────────────────────────────
create or replace function public.embedding_job_fail(p_job_id uuid, p_error text)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  update public.embedding_jobs
     set status = 'failed', error_message = p_error
   where job_id = p_job_id
     and status = 'processing';
$$;

comment on function public.embedding_job_fail(uuid, text) is
  'G1 (0634): marks a claimed embedding job failed with its error (the claim counted the attempt); a job re-queued since the claim stays pending. service_role only.';

revoke all on function public.embedding_job_fail(uuid, text) from public, anon, authenticated;
grant execute on function public.embedding_job_fail(uuid, text) to service_role;

commit;
