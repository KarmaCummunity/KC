-- Matching · pairs (docs/SSOT/MATCHING_V2.md, design §3.10)
--
-- A pair is an open offer and an open request of the same giving world that the engine
-- scored as fitting each other. Both owners are told (above a score threshold), each
-- answers, and a decline closes the pair for good. Pairs are internal: a member reads
-- their own through my_matches() and answers through match_respond().

-- Lifecycle, machine `match`:
--   suggested ─► accepted    both owners accepted            (member)
--   suggested ─► declined    either owner declined            (member)
--   suggested ◄─► expired    a post went off the air or the pair no longer scores, and
--                            back when it does again          (system)
insert into kc_private.fsm_state (machine_id, status) values
  ('match', 'suggested'),
  ('match', 'accepted'),
  ('match', 'declined'),
  ('match', 'expired');
insert into kc_private.fsm_edge (machine_id, from_status, to_status, role) values
  ('match', 'suggested', 'accepted', 'member'),
  ('match', 'suggested', 'declined', 'member'),
  ('match', 'suggested', 'expired', 'system'),
  ('match', 'expired', 'suggested', 'system');

create table kc_private.match_candidates (
  id                   uuid primary key default gen_random_uuid(),
  offer_post_id        uuid not null references public.posts (id) on delete cascade,
  request_post_id      uuid not null references public.posts (id) on delete cascade,
  -- Owners copied from the posts, so "my matches" never joins to find them.
  offer_owner_id       uuid not null references public.users (id) on delete cascade,
  request_owner_id     uuid not null references public.users (id) on delete cascade,
  world_slug           text not null references public.worlds (slug) on update cascade,
  score                numeric(5, 4) not null check (score between 0 and 1),
  -- The measured components, each 0..1: category, text, vector, geo, time.
  components           jsonb not null default '{}'::jsonb check (jsonb_typeof(components) = 'object'),
  distance_km          numeric(9, 2) check (distance_km >= 0),
  -- Lifecycle, machine `match`.
  status               text not null default 'suggested',
  offer_response       text check (offer_response in ('accepted', 'declined')),
  request_response     text check (request_response in ('accepted', 'declined')),
  offer_responded_at   timestamptz,
  request_responded_at timestamptz,
  -- When each owner was told about the pair; null = not yet.
  notified_offer_at    timestamptz,
  notified_request_at  timestamptz,
  -- The language model's opinion (Edge Function `match-rerank`).
  llm_score            numeric(5, 4) check (llm_score between 0 and 1),
  llm_reason           text check (char_length(llm_reason) <= 280),
  llm_scored_at        timestamptz,
  -- Last time the engine scored the pair.
  computed_at          timestamptz not null default now(),
  created_at           timestamptz not null default now(),
  -- One pair per two posts; also covers the offer post foreign key.
  constraint match_candidates_pair_key unique (offer_post_id, request_post_id),
  constraint match_candidates_distinct_owners_chk check (offer_owner_id <> request_owner_id)
);
comment on table kc_private.match_candidates is 'Scored offer and request pairs with each owner''s answer. Written only by the matching engine.';

-- Pairs of a request post (recompute, expiry); covers its foreign key.
create index match_candidates_request_post_idx on kc_private.match_candidates (request_post_id);
-- "My matches", the daily announcement cap and "these two owners declined before", from
-- either side; cover the owner foreign keys.
create index match_candidates_offer_owner_idx on kc_private.match_candidates (offer_owner_id, status);
create index match_candidates_request_owner_idx on kc_private.match_candidates (request_owner_id, status);
-- Announcement run: live pairs with an owner still to be told, best first.
create index match_candidates_unannounced_idx on kc_private.match_candidates (score desc)
  where status = 'suggested' and (notified_offer_at is null or notified_request_at is null);
-- Language-model run: live pairs without an opinion yet, newest first.
create index match_candidates_llm_pending_idx on kc_private.match_candidates (computed_at desc)
  where status = 'suggested' and llm_scored_at is null;
-- Covers the world foreign key (a world being renamed).
create index match_candidates_world_idx on kc_private.match_candidates (world_slug);

create trigger match_candidates_status_fsm
  before insert or update of status on kc_private.match_candidates
  for each row execute function kc_private.fsm_guard_status('match', 'status');

-- When the engine last looked at a post, and what came of it.
create table kc_private.match_state (
  post_id     uuid primary key references public.posts (id) on delete cascade,
  computed_at timestamptz not null default now(),
  -- Live pairs kept by the last run.
  candidates  integer not null default 0 check (candidates >= 0),
  last_error  text
);
comment on table kc_private.match_state is 'Per post: last matching run, pairs kept, last error.';

alter table kc_private.match_candidates enable row level security;
alter table kc_private.match_candidates force row level security;
alter table kc_private.match_state enable row level security;
alter table kc_private.match_state force row level security;
