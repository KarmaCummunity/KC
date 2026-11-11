-- 0420_matching_v2_schema | Matching engine v2 (KC core goal 2): automatic offer↔request
-- matching from the database for items, food, rides, time and knowledge.
--
--   matching_settings      singleton knobs (weights per world, thresholds, caps, quiet hours,
--                          LLM re-rank flag — OFF by default).
--   match_candidates       scored offer↔request pairs, one row per pair (idempotent upsert),
--                          per-side responses + delivery bookkeeping.
--   match_listing_state    last compute per listing (drives the pg_cron sweep).
--
-- The v1 tables (listing_matches / find_matches, 0260) stay untouched for operator tooling.

begin;

create table if not exists public.matching_settings (
  id                        boolean primary key default true check (id),
  enabled                   boolean not null default true,
  inline_on_write           boolean not null default true,
  worlds                    text[] not null default array['items', 'food', 'rides', 'time', 'knowledge'],
  min_score                 numeric(5, 4) not null default 0.4500 check (min_score between 0 and 1),
  notify_min_score          numeric(5, 4) not null default 0.6000 check (notify_min_score between 0 and 1),
  max_candidates_per_listing integer not null default 10 check (max_candidates_per_listing between 1 and 50),
  scan_limit                integer not null default 500 check (scan_limit between 10 and 5000),
  max_notify_per_user_day   integer not null default 3 check (max_notify_per_user_day between 0 and 50),
  notify_max_age_hours      integer not null default 72 check (notify_max_age_hours > 0),
  quiet_start               time not null default '22:00',
  quiet_end                 time not null default '08:00',
  quiet_tz                  text not null default 'Asia/Jerusalem',
  sweep_batch               integer not null default 200 check (sweep_batch between 1 and 2000),
  recompute_after_hours     integer not null default 24 check (recompute_after_hours > 0),
  llm_rerank_enabled        boolean not null default false,
  llm_weight                numeric(4, 3) not null default 0.300 check (llm_weight between 0 and 1),
  weights                   jsonb not null default jsonb_build_object(
    'default',   jsonb_build_object('category', 0.25, 'geo', 0.25, 'time', 0.10, 'text', 0.20, 'trust', 0.10, 'feedback', 0.10),
    'rides',     jsonb_build_object('category', 0.00, 'geo', 0.45, 'time', 0.30, 'text', 0.05, 'trust', 0.10, 'feedback', 0.10),
    'knowledge', jsonb_build_object('category', 0.35, 'geo', 0.05, 'time', 0.10, 'text', 0.30, 'trust', 0.15, 'feedback', 0.05),
    'time',      jsonb_build_object('category', 0.25, 'geo', 0.20, 'time', 0.25, 'text', 0.15, 'trust', 0.10, 'feedback', 0.05)
  ),
  updated_at                timestamptz not null default now()
);

comment on table public.matching_settings is
  'Matching engine v2 knobs (singleton). llm_rerank_enabled stays OFF until a GEMINI key exists (#929).';

insert into public.matching_settings (id) values (true) on conflict (id) do nothing;

alter table public.matching_settings enable row level security;
revoke all on public.matching_settings from anon, authenticated;
grant select on public.matching_settings to authenticated;

create policy matching_settings_admin_read on public.matching_settings
  for select to authenticated
  using (public.has_admin_role((select auth.uid()), 'super_admin'));

create table if not exists public.match_candidates (
  candidate_id        uuid primary key default gen_random_uuid(),
  offer_listing_id    uuid not null references public.listings(listing_id) on delete cascade,
  request_listing_id  uuid not null references public.listings(listing_id) on delete cascade,
  offer_owner_id      uuid not null references public.users(user_id) on delete cascade,
  request_owner_id    uuid not null references public.users(user_id) on delete cascade,
  world_slug          text not null references public.worlds(slug),
  score               numeric(6, 4) not null check (score between 0 and 1),
  components          jsonb not null default '{}'::jsonb,
  distance_km         numeric(9, 2),
  status              text not null default 'suggested'
    check (status in ('suggested', 'accepted', 'declined', 'expired', 'withdrawn')),
  offer_response      text check (offer_response in ('accepted', 'declined')),
  request_response    text check (request_response in ('accepted', 'declined')),
  offer_responded_at  timestamptz,
  request_responded_at timestamptz,
  notified_offer_at   timestamptz,
  notified_request_at timestamptz,
  delivery            jsonb not null default '{}'::jsonb,
  llm_score           numeric(5, 4) check (llm_score is null or llm_score between 0 and 1),
  llm_reason          text check (llm_reason is null or char_length(llm_reason) <= 280),
  llm_scored_at       timestamptz,
  computed_at         timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint match_candidates_pair_unique unique (offer_listing_id, request_listing_id),
  constraint match_candidates_distinct_owners check (offer_owner_id <> request_owner_id)
);

comment on table public.match_candidates is
  'Matching v2: scored offer↔request pairs (0420–0423). Written only by SECURITY DEFINER engine functions.';
comment on column public.match_candidates.components is
  'Score breakdown 0..1: category, geo, time, text, trust, feedback (+ weights used).';
comment on column public.match_candidates.delivery is
  'Per-side delivery log: {offer|request: {inapp, whatsapp, at}}.';

create index if not exists match_candidates_offer_idx
  on public.match_candidates (offer_listing_id, score desc);
create index if not exists match_candidates_request_idx
  on public.match_candidates (request_listing_id, score desc);
create index if not exists match_candidates_offer_owner_idx
  on public.match_candidates (offer_owner_id, score desc) where status in ('suggested', 'accepted');
create index if not exists match_candidates_request_owner_idx
  on public.match_candidates (request_owner_id, score desc) where status in ('suggested', 'accepted');
create index if not exists match_candidates_pending_offer_idx
  on public.match_candidates (computed_at desc) where status = 'suggested' and notified_offer_at is null;
create index if not exists match_candidates_pending_request_idx
  on public.match_candidates (computed_at desc) where status = 'suggested' and notified_request_at is null;
create index if not exists match_candidates_offer_notified_idx
  on public.match_candidates (offer_owner_id, notified_offer_at) where notified_offer_at is not null;
create index if not exists match_candidates_request_notified_idx
  on public.match_candidates (request_owner_id, notified_request_at) where notified_request_at is not null;

create trigger match_candidates_set_updated_at
  before update on public.match_candidates
  for each row execute function public.set_updated_at();

alter table public.match_candidates enable row level security;
revoke all on public.match_candidates from anon, authenticated;
grant select on public.match_candidates to authenticated;

-- Participants read their own pairs (the app goes through rpc_my_matches, which also checks
-- the counterpart listing is still visible); operators read all for support.
create policy match_candidates_participant_read on public.match_candidates
  for select to authenticated
  using (
    offer_owner_id = (select auth.uid())
    or request_owner_id = (select auth.uid())
    or public.is_listing_operator((select auth.uid()))
  );

create table if not exists public.match_listing_state (
  listing_id     uuid primary key references public.listings(listing_id) on delete cascade,
  computed_at    timestamptz not null default now(),
  candidates     integer not null default 0,
  last_error     text
);

alter table public.match_listing_state enable row level security;
revoke all on public.match_listing_state from anon, authenticated;

create policy match_listing_state_operator_read on public.match_listing_state
  for select to authenticated
  using (public.is_listing_operator((select auth.uid())));
grant select on public.match_listing_state to authenticated;

commit;
