-- 0281_feed_social_filters_schema | KC#870 — ranking config, hide/mute, impressions.

create table if not exists public.feed_ranking_config (
  config_key   text primary key,
  weight       double precision not null check (weight >= 0),
  updated_at   timestamptz not null default now()
);

insert into public.feed_ranking_config (config_key, weight) values
  ('freshness', 0.35),
  ('follow_graph', 0.25),
  ('engagement', 0.20),
  ('geo', 0.15),
  ('interest_category', 0.05)
on conflict (config_key) do nothing;

alter table public.feed_ranking_config enable row level security;
create policy feed_ranking_config_read on public.feed_ranking_config
  for select to authenticated, anon using (true);

create table if not exists public.feed_post_hides (
  user_id    uuid not null references public.users(user_id) on delete cascade,
  post_id    uuid not null references public.posts(post_id) on delete cascade,
  hidden_at  timestamptz not null default now(),
  primary key (user_id, post_id)
);

create index if not exists feed_post_hides_user_idx on public.feed_post_hides (user_id, hidden_at desc);

alter table public.feed_post_hides enable row level security;
grant select, insert, delete on public.feed_post_hides to authenticated;

create policy feed_post_hides_own on public.feed_post_hides
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create table if not exists public.feed_mute_filters (
  filter_id     uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(user_id) on delete cascade,
  filter_kind   text not null check (filter_kind in ('user', 'category', 'keyword', 'world')),
  filter_value  text not null check (char_length(trim(filter_value)) between 1 and 120),
  created_at    timestamptz not null default now(),
  unique (user_id, filter_kind, filter_value)
);

create index if not exists feed_mute_filters_user_idx on public.feed_mute_filters (user_id);

alter table public.feed_mute_filters enable row level security;
grant select, insert, delete on public.feed_mute_filters to authenticated;

create policy feed_mute_filters_own on public.feed_mute_filters
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create table if not exists public.feed_impressions (
  impression_id uuid not null default gen_random_uuid(),
  user_id       uuid not null references public.users(user_id) on delete cascade,
  post_id       uuid not null references public.posts(post_id) on delete cascade,
  seen_at       timestamptz not null default now(),
  primary key (impression_id, seen_at)
) partition by range (seen_at);

create table if not exists public.feed_impressions_default
  partition of public.feed_impressions default;

create index if not exists feed_impressions_user_seen_idx
  on public.feed_impressions (user_id, seen_at desc);

alter table public.feed_impressions enable row level security;
alter table public.feed_impressions_default enable row level security;
grant insert on public.feed_impressions to authenticated;

create policy feed_impressions_insert_own on public.feed_impressions
  for insert to authenticated
  with check (user_id = (select auth.uid()));

-- Direct access to the default partition mirrors the parent's insert-own rule
-- (queries through the parent use the parent's policies).
create policy feed_impressions_default_insert_own on public.feed_impressions_default
  for insert to authenticated
  with check (user_id = (select auth.uid()));
