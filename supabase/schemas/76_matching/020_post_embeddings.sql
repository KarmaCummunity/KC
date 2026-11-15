-- Matching · post embeddings and their job queue (design §3.10)
--
-- An embedding is the meaning of a post's text as a vector; matching, similar posts and
-- recommendations compare posts by it. The vector is computed outside the database: a post
-- that needs one records an outbox event on topic `embedding` (050_match_processing.sql),
-- the `embed-worker` Edge Function claims jobs, calls the model and stores the result.
-- One job per post however often it was edited, with attempts and the last error.

create table public.post_embeddings (
  post_id         uuid primary key references public.posts (id) on delete cascade,
  embedding       extensions.vector(1536) not null,
  embedding_model text not null check (char_length(embedding_model) between 1 and 100),
  updated_at      timestamptz not null default now()
);
comment on table public.post_embeddings is
  'Embedding of a post''s text. Readable by nobody from a device; used by server code only.';

-- Nearest posts by cosine distance: match candidates, similar posts, recommendations.
create index post_embeddings_hnsw_idx on public.post_embeddings
  using hnsw (embedding extensions.vector_cosine_ops);

create trigger post_embeddings_set_updated_at
  before update on public.post_embeddings
  for each row execute function kc_private.set_updated_at();

-- No policy and no grant: a vector reveals the text it was made from.
alter table public.post_embeddings enable row level security;
alter table public.post_embeddings force row level security;

create table kc_private.embedding_jobs (
  post_id      uuid primary key references public.posts (id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending', 'processing', 'done', 'failed')),
  model        text not null default 'text-embedding-3-small' check (char_length(model) between 1 and 100),
  attempts     integer not null default 0 check (attempts >= 0),
  -- When the post last asked for a fresh embedding; the queue is served oldest first.
  requested_at timestamptz not null default now(),
  -- Set while a worker holds the job; a claim older than ten minutes is taken over.
  claimed_at   timestamptz,
  last_error   text
);
comment on table kc_private.embedding_jobs is 'One embedding job per post: queue state, attempts, last error.';

-- Claim query: waiting jobs, and jobs whose worker went silent, oldest request first.
create index embedding_jobs_due_idx on kc_private.embedding_jobs (requested_at)
  where status in ('pending', 'processing');

alter table kc_private.embedding_jobs enable row level security;
alter table kc_private.embedding_jobs force row level security;

-- Worker call 1 of 3. Turns the waiting `embedding` outbox events into jobs (a post edited
-- five times is one job), then hands the worker up to p_limit jobs with the text to embed.
-- Concurrent workers never receive the same job (SKIP LOCKED); a job whose worker died is
-- handed out again after ten minutes, at most five times.
create function public.embedding_jobs_claim(p_limit integer default 20)
returns table (job_id uuid, post_id uuid, model text, title text, summary text, details jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event record;
begin
  for v_event in
    select e.id, (e.payload ->> 'post_id')::uuid as post_id from kc_private.outbox_claim('embedding', 500) e
  loop
    insert into kc_private.embedding_jobs as j (post_id)
    select p.id from public.posts p where p.id = v_event.post_id
    on conflict on constraint embedding_jobs_pkey do update
      set status = 'pending', attempts = 0, requested_at = now(), claimed_at = null, last_error = null;
    perform kc_private.outbox_complete(v_event.id);
  end loop;

  return query
  with claimed as (
    update kc_private.embedding_jobs j
       set status = 'processing', attempts = j.attempts + 1, claimed_at = now()
     where j.post_id in (
             select c.post_id
               from kc_private.embedding_jobs c
              where (c.status = 'pending'
                     or (c.status = 'processing' and c.claimed_at <= now() - interval '10 minutes'))
                and c.attempts < 5
              order by c.requested_at
              limit least(greatest(coalesce(p_limit, 20), 1), 50)
                for update skip locked)
    returning j.post_id, j.model, j.requested_at
  )
  select c.post_id, c.post_id, c.model, p.title, p.description, p.details
    from claimed c
    join public.posts p on p.id = c.post_id
   order by c.requested_at, c.post_id;
end;
$$;
comment on function public.embedding_jobs_claim(integer) is
  'embed-worker: claims embedding jobs and returns the post text to embed. Service role only.';

-- Worker call 2 of 3. Stores the embedding of a claimed job and closes the job — unless the
-- post asked for a fresh embedding since the claim, in which case the job stays waiting.
-- The post is queued for matching again, now that its meaning can be compared.
-- Returns whether the job was closed.
create function public.embedding_job_store(p_job_id uuid, p_embedding extensions.vector, p_model text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_closed integer;
begin
  if not exists (select 1 from kc_private.embedding_jobs j where j.post_id = p_job_id) then
    raise exception 'embedding_job_not_found' using errcode = 'P0001';
  end if;
  insert into public.post_embeddings as e (post_id, embedding, embedding_model)
  values (p_job_id, p_embedding, p_model)
  on conflict (post_id) do update
    set embedding = excluded.embedding, embedding_model = excluded.embedding_model;

  update kc_private.embedding_jobs j
     set status = 'done', claimed_at = null, last_error = null
   where j.post_id = p_job_id and j.status = 'processing';
  get diagnostics v_closed = row_count;
  perform kc_private.outbox_enqueue('match', jsonb_build_object('post_id', p_job_id));
  return v_closed > 0;
end;
$$;
comment on function public.embedding_job_store(uuid, extensions.vector, text) is
  'embed-worker: stores a post''s embedding and closes its job. Service role only.';

-- Worker call 3 of 3. Marks a claimed job failed with its error; a job re-queued since the
-- claim stays waiting.
create function public.embedding_job_fail(p_job_id uuid, p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
  update kc_private.embedding_jobs j
     set status = 'failed', claimed_at = null, last_error = left(p_error, 1000)
   where j.post_id = p_job_id and j.status = 'processing';
$$;
comment on function public.embedding_job_fail(uuid, text) is
  'embed-worker: records the failure of a claimed embedding job. Service role only.';
