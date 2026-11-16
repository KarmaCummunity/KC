-- External post import: what the extraction Edge Function keeps (FR-IMPORT-008, FR-IMPORT-009,
-- ADR-008). Two tables and nothing else: the function writes with the service role, a member
-- may read and delete their own import records.

-- One row per extraction attempt of a member. It holds NO raw text: only the fingerprint of the
-- scrubbed text, the validated extraction (post-scrub, without contact details), the routing and
-- the provenance. Per-member limits and the daily provider budget are counted from it.
create table public.external_post_imports (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.users (id) on delete cascade,
  channel            text not null check (channel in ('share', 'paste')),
  source_platform    text not null default 'unknown'
                       check (source_platform in ('whatsapp', 'facebook', 'yad2', 'other', 'unknown')),
  -- SHA-256 (hex) of the canonical form of the scrubbed text; same text, same fingerprint.
  text_fingerprint   text not null check (text_fingerprint ~ '^[0-9a-f]{64}$'),
  routing            text not null check (routing in ('ready', 'confirm', 'manual')),
  -- Why the draft is what it is: ok, empty_text, not_a_post, rejected, provider_failed,
  -- invalid_result, rate_limited, budget_exhausted or account_too_new.
  reason             text not null check (char_length(reason) between 1 and 40),
  confidence         numeric(3, 2) not null default 0 check (confidence between 0 and 1),
  -- The validated extraction; null when the route was manual before any extraction.
  extraction         jsonb check (jsonb_typeof(extraction) = 'object'),
  -- Prompt version that produced it, so a change of prompt is attributable (FR-IMPORT-010 AC5).
  extraction_version text not null check (char_length(extraction_version) between 1 and 20),
  model              text check (char_length(model) between 1 and 100),
  -- True when a model call was made for this attempt; the daily budget counts these.
  provider_called    boolean not null default false,
  status             text not null default 'drafted' check (status in ('drafted', 'published', 'discarded')),
  post_id            uuid references public.posts (id) on delete set null,
  created_at         timestamptz not null default now()
);
comment on table public.external_post_imports is
  'One extraction attempt per row (no raw text); source of the per-member limits and the daily provider budget (FR-IMPORT-008, FR-IMPORT-009).';

-- A member's recent attempts (the hourly and daily limits) and the newest first.
create index external_post_imports_user_created_idx
  on public.external_post_imports (user_id, created_at desc);
-- Today's model calls (the daily budget), and the oldest rows for retention.
create index external_post_imports_created_idx
  on public.external_post_imports (created_at);
-- Covers the post foreign key (set null on removing a post).
create index external_post_imports_post_idx
  on public.external_post_imports (post_id) where post_id is not null;

alter table public.external_post_imports enable row level security;
alter table public.external_post_imports force row level security;

create policy external_post_imports_select_self on public.external_post_imports
  for select to authenticated
  using (user_id = (select auth.uid()));

-- A member may delete their own import records (FR-IMPORT-009 AC5).
create policy external_post_imports_delete_self on public.external_post_imports
  for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, delete on public.external_post_imports to authenticated;
grant select, insert, update, delete on public.external_post_imports to service_role;

-- Validated provider answers by text fingerprint, so the same text is not sent to the model
-- twice within a day (FR-IMPORT-008 AC2). No member id and no text: only what the model
-- returned for the scrubbed text. Written and read by the service role; a stale or other-version
-- row is ignored by the reader and replaced by the writer.
create table public.post_extraction_cache (
  fingerprint        text primary key check (fingerprint ~ '^[0-9a-f]{64}$'),
  extraction_version text not null check (char_length(extraction_version) between 1 and 20),
  result             jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at         timestamptz not null default now()
);
comment on table public.post_extraction_cache is
  'Day cache of validated extraction answers by fingerprint of the scrubbed text; service role only (FR-IMPORT-008 AC2).';

-- The writer clears expired rows through this index.
create index post_extraction_cache_created_idx on public.post_extraction_cache (created_at);

alter table public.post_extraction_cache enable row level security;
alter table public.post_extraction_cache force row level security;
-- No policy: no API role can read or write the cache; the service role bypasses row security.
grant select, insert, update, delete on public.post_extraction_cache to service_role;

-- Kill switch of the whole feature (FR-IMPORT-001 AC4); off until the super admin switches it on.
insert into public.app_flags (key, enabled, description)
values ('external_post_import_enabled', false, 'Import a post shared from WhatsApp, Facebook or Yad2: share target, paste field and extraction (FR-IMPORT-001)')
on conflict (key) do nothing;
