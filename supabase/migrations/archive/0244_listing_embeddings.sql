-- 0244_listing_embeddings | Issue #827
-- Semantic embeddings on listings + job queue for embed-worker.

begin;

alter table public.listings
  add column if not exists embedding extensions.vector(1536),
  add column if not exists embedding_model text;

create index if not exists listings_embedding_hnsw_idx
  on public.listings using hnsw (embedding extensions.vector_cosine_ops)
  where embedding is not null;

create table public.embedding_jobs (
  job_id       uuid primary key default gen_random_uuid(),
  listing_id   uuid not null references public.listings(listing_id) on delete cascade,
  status       text not null default 'pending'
    check (status in ('pending','processing','done','failed')),
  model        text not null default 'text-embedding-3-small',
  error_message text,
  attempts     integer not null default 0 check (attempts >= 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint embedding_jobs_listing_unique unique (listing_id)
);

create index embedding_jobs_pending_idx
  on public.embedding_jobs (created_at)
  where status = 'pending';

create trigger embedding_jobs_set_updated_at
  before update on public.embedding_jobs
  for each row execute function public.set_updated_at();

alter table public.embedding_jobs enable row level security;

create policy embedding_jobs_service_all on public.embedding_jobs
  for all to service_role using (true) with check (true);

create or replace function public.enqueue_listing_embedding_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and new.title is not distinct from old.title
     and new.summary is not distinct from old.summary
     and new.details is not distinct from old.details then
    return new;
  end if;

  insert into public.embedding_jobs (listing_id, status)
  values (new.listing_id, 'pending')
  on conflict (listing_id) do update set
    status = 'pending',
    attempts = 0,
    error_message = null,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists listings_enqueue_embedding on public.listings;
create trigger listings_enqueue_embedding
  after insert or update of title, summary, details on public.listings
  for each row
  when (new.moderation_status = 'published')
  execute function public.enqueue_listing_embedding_job();

commit;
