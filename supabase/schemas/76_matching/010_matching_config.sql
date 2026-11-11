-- Matching · configuration (docs/SSOT/MATCHING_V2.md "Tuning", design §3.10)
--
-- The knobs of the matching engine and the weights of its score. Both are read by server
-- code only and tuned by changing a row; nothing here is reachable from a device.

-- Engine settings: exactly one row.
create table kc_private.matching_settings (
  id                      boolean primary key default true check (id),
  -- Off = no new pairs are computed and none are announced.
  enabled                 boolean not null default true,
  -- A pair below this score is not kept.
  min_score               numeric(5, 4) not null default 0.4500 check (min_score between 0 and 1),
  -- A pair is announced to its two owners from this score up (spec 07 §7.3).
  notify_min_score        numeric(5, 4) not null default 0.6000 check (notify_min_score between 0 and 1),
  max_candidates_per_post integer not null default 10 check (max_candidates_per_post between 1 and 50),
  -- How many of the newest opposite posts of the world one run looks at.
  scan_limit              integer not null default 500 check (scan_limit between 10 and 5000),
  -- At most this many match announcements per member per Israel day (spec 07 §7.11).
  max_notify_per_user_day integer not null default 3 check (max_notify_per_user_day between 0 and 50),
  -- A pair older than this is no longer announced.
  notify_max_age_hours    integer not null default 72 check (notify_max_age_hours > 0),
  -- Optional language-model second opinion (Edge Function `match-rerank`).
  llm_rerank_enabled      boolean not null default false,
  llm_weight              numeric(4, 3) not null default 0.300 check (llm_weight between 0 and 1),
  updated_at              timestamptz not null default now()
);
comment on table kc_private.matching_settings is 'Settings of the matching engine (one row).';

create trigger matching_settings_set_updated_at
  before update on kc_private.matching_settings
  for each row execute function kc_private.set_updated_at();

-- Share of each component in the score of a pair, per giving world; '' = every world
-- without a row of its own. A component that cannot be measured for a pair (no embedding
-- yet, no time window) is left out and the rest is re-normalised.
create table kc_private.match_weights (
  world_slug text primary key,
  -- Same item subcategory.
  w_category numeric(4, 3) not null default 0.150 check (w_category between 0 and 1),
  -- Words in common (full-text tokens and trigram similarity of the titles).
  w_text     numeric(4, 3) not null default 0.300 check (w_text between 0 and 1),
  -- Meaning in common (cosine similarity of the post embeddings).
  w_vector   numeric(4, 3) not null default 0.250 check (w_vector between 0 and 1),
  -- Closeness, within the world's radius.
  w_geo      numeric(4, 3) not null default 0.200 check (w_geo between 0 and 1),
  -- Overlapping time windows.
  w_time     numeric(4, 3) not null default 0.100 check (w_time between 0 and 1),
  -- Two posts are paired only when their words or their meaning agree at least this much:
  -- being close by is never enough on its own (MATCHING_V2 "text gate").
  min_relevance numeric(4, 3) not null default 0.300 check (min_relevance between 0 and 1),
  updated_at timestamptz not null default now(),
  constraint match_weights_sum_chk check (w_category + w_text + w_vector + w_geo + w_time = 1)
);
comment on table kc_private.match_weights is 'Weights of the match score per giving world; the row with an empty slug is the default.';

create trigger match_weights_set_updated_at
  before update on kc_private.match_weights
  for each row execute function kc_private.set_updated_at();

alter table kc_private.matching_settings enable row level security;
alter table kc_private.matching_settings force row level security;
alter table kc_private.match_weights enable row level security;
alter table kc_private.match_weights force row level security;

-- The engine's defaults. Configuration, not data: the engine reads exactly these two rows
-- until an operator tunes them or adds a world's own weights.
insert into kc_private.matching_settings default values;
insert into kc_private.match_weights (world_slug) values ('');

-- A pair's score as shown and ranked: the engine's score, blended with the language
-- model's opinion when that is switched on and has been given.
create function kc_private.match_effective_score(p_score numeric, p_llm_score numeric)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case when s.llm_rerank_enabled and p_llm_score is not null
              then round((1 - s.llm_weight) * p_score + s.llm_weight * p_llm_score, 4)
              else p_score end
    from kc_private.matching_settings s;
$$;
comment on function kc_private.match_effective_score(numeric, numeric) is
  'Score of a pair after the optional language-model blend.';
