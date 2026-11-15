-- 0246_ingestion_pipeline | Issue #832 (ingestion sources → listings)

begin;

alter table public.listings drop constraint if exists listings_origin_check;
alter table public.listings add constraint listings_origin_check
  check (origin in ('native','post','ride_listing','ingestion'));

create table public.ingestion_sources (
  source_id     uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  source_type   text not null check (source_type in ('whatsapp','website','manual')),
  label         text not null,
  consent_ref   text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

create table public.ingestion_runs (
  run_id        uuid primary key default gen_random_uuid(),
  source_id     uuid not null references public.ingestion_sources(source_id) on delete cascade,
  status        text not null default 'running'
    check (status in ('running','completed','failed')),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  stats         jsonb not null default '{}'::jsonb
);

create table public.raw_records (
  record_id     uuid primary key default gen_random_uuid(),
  run_id        uuid not null references public.ingestion_runs(run_id) on delete cascade,
  external_key  text,
  payload       jsonb not null,
  fetched_at    timestamptz not null default now(),
  retain_until  timestamptz
);

create index raw_records_retain_idx on public.raw_records (retain_until)
  where retain_until is not null;

create table public.extractions (
  extraction_id uuid primary key default gen_random_uuid(),
  record_id     uuid not null references public.raw_records(record_id) on delete cascade,
  listing_id    uuid references public.listings(listing_id) on delete set null,
  world_slug    text references public.worlds(slug),
  kind_slug     text,
  confidence    numeric(4, 3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  extracted     jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create table public.field_provenance (
  provenance_id uuid primary key default gen_random_uuid(),
  listing_id    uuid not null references public.listings(listing_id) on delete cascade,
  field_path    text not null,
  source_id     uuid references public.ingestion_sources(source_id),
  record_id     uuid references public.raw_records(record_id),
  extracted_at  timestamptz not null default now()
);

create table public.claim_requests (
  claim_id      uuid primary key default gen_random_uuid(),
  listing_id    uuid not null references public.listings(listing_id) on delete cascade,
  requester_id  uuid not null references public.users(user_id) on delete cascade,
  status        text not null default 'pending'
    check (status in ('pending','approved','rejected')),
  created_at    timestamptz not null default now()
);

alter table public.ingestion_sources enable row level security;
alter table public.ingestion_runs enable row level security;
alter table public.raw_records enable row level security;
alter table public.extractions enable row level security;
alter table public.field_provenance enable row level security;
alter table public.claim_requests enable row level security;

create policy ingestion_sources_select_all on public.ingestion_sources
  for select to authenticated using (is_active);

create policy ingestion_runs_service on public.ingestion_runs
  for all to service_role using (true) with check (true);

create policy raw_records_service on public.raw_records
  for all to service_role using (true) with check (true);

create policy extractions_service on public.extractions
  for all to service_role using (true) with check (true);

create policy field_provenance_select on public.field_provenance
  for select to authenticated using (true);

create policy claim_requests_own on public.claim_requests
  for all to authenticated using (requester_id = auth.uid()) with check (requester_id = auth.uid());

commit;
