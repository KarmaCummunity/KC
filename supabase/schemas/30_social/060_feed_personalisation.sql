-- Social · feed personalisation (hides, mute filters, ranking configuration, impressions)
--
-- What a member has asked not to see, the weights of the recommended sort, and the log of
-- what the feed has shown. The member-owned tables are written as plain rows under RLS.

-- ── Posts a member hid from their feed ───────────────────────────────────────
create table public.feed_hides (
  user_id   uuid not null references public.users (id) on delete cascade,
  post_id   uuid not null references public.posts (id) on delete cascade,
  hidden_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
comment on table public.feed_hides is 'Posts a member removed from their own feed. The post stays reachable elsewhere.';

-- Removal with the post; covers the post foreign key.
create index feed_hides_post_idx on public.feed_hides (post_id);

alter table public.feed_hides enable row level security;
alter table public.feed_hides force row level security;

create policy feed_hides_own on public.feed_hides
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, delete on public.feed_hides to authenticated;
grant insert (user_id, post_id) on public.feed_hides to authenticated;

-- ── Things a member muted in their feed ──────────────────────────────────────
-- One row per muted member, giving world or keyword; exactly the column of its kind is set.
create table public.feed_mute_filters (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users (id) on delete cascade,
  filter_kind   text not null check (filter_kind in ('user', 'world', 'keyword')),
  muted_user_id uuid references public.users (id) on delete cascade,
  world_slug    text references public.worlds (slug) on update cascade on delete cascade,
  -- Matched as a substring of the post's title and description; stored lower-case.
  keyword       text check (char_length(keyword) between 2 and 60 and keyword = lower(btrim(keyword))),
  created_at    timestamptz not null default now(),
  constraint feed_mute_filters_kind_chk check (
    (filter_kind = 'user') = (muted_user_id is not null)
    and (filter_kind = 'world') = (world_slug is not null)
    and (filter_kind = 'keyword') = (keyword is not null)),
  constraint feed_mute_filters_not_self_chk check (muted_user_id <> user_id),
  -- One row per muted thing; together the three constraints also serve "my mute filters",
  -- which the feed reads on every page, and cover the member foreign key.
  constraint feed_mute_filters_user_key unique (user_id, muted_user_id),
  constraint feed_mute_filters_world_key unique (user_id, world_slug),
  constraint feed_mute_filters_keyword_key unique (user_id, keyword)
);
comment on table public.feed_mute_filters is 'Members, giving worlds and keywords a member muted in their feed.';

-- Removal with the muted member or world; cover those two foreign keys.
create index feed_mute_filters_muted_user_idx on public.feed_mute_filters (muted_user_id)
  where muted_user_id is not null;
create index feed_mute_filters_world_idx on public.feed_mute_filters (world_slug)
  where world_slug is not null;

alter table public.feed_mute_filters enable row level security;
alter table public.feed_mute_filters force row level security;

create policy feed_mute_filters_own on public.feed_mute_filters
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, delete on public.feed_mute_filters to authenticated;
grant insert (id, user_id, filter_kind, muted_user_id, world_slug, keyword)
  on public.feed_mute_filters to authenticated;

-- ── Weights of the recommended sort (S33) ────────────────────────────────────
-- One row per setting that differs from the default written in feed_page; an empty table
-- means every default applies. Changed by operators through server code, never by a device.
--   window_hours     width of a ranking window: newer windows always come first, and the
--                    signals below order the posts inside one window (default 24)
--   follow_affinity  the viewer follows the owner (default 1)
--   active_world     the viewer has published in the post's giving world (default 0.5)
--   distance         closeness to the viewer's city, scaled by the world's geo_weight (default 1)
--   urgency          urgency level, or expiry within 48 hours (default 0.75)
--   no_response      nobody has commented yet (default 0.25)
create table public.feed_ranking_config (
  config_key text primary key check (config_key in
               ('window_hours', 'follow_affinity', 'active_world', 'distance', 'urgency', 'no_response')),
  value      numeric(8, 3) not null check (value >= 0),
  updated_at timestamptz not null default now(),
  constraint feed_ranking_config_window_chk check (config_key <> 'window_hours' or value between 1 and 720)
);
comment on table public.feed_ranking_config is 'Overrides of the recommended-sort weights; defaults live in feed_page.';

create trigger feed_ranking_config_set_updated_at
  before update on public.feed_ranking_config
  for each row execute function kc_private.set_updated_at();

alter table public.feed_ranking_config enable row level security;
alter table public.feed_ranking_config force row level security;

-- Readable by members: the feed query runs with the caller's rights.
create policy feed_ranking_config_select_member on public.feed_ranking_config
  for select to authenticated
  using (true);

grant select on public.feed_ranking_config to authenticated;

-- ── Impressions (what the feed showed to whom) ───────────────────────────────
-- Append-only log, partitioned by month so that retention (90 days, design §3.4) is a
-- partition drop. post_id deliberately has no foreign key: a removed post's impressions are
-- harmless, expire with their partition, and a cascade would have to search every partition.
create table public.feed_impressions (
  user_id uuid not null default auth.uid() references public.users (id) on delete cascade,
  post_id uuid not null,
  seen_at timestamptz not null default now()
) partition by range (seen_at);
comment on table public.feed_impressions is 'Append-only log of posts shown in a member''s feed; monthly partitions.';

-- A member's recent impressions, and their removal with the account; covers the foreign key.
create index feed_impressions_user_seen_idx on public.feed_impressions (user_id, seen_at desc);

-- Catches rows of a month whose partition the maintenance job has not created yet.
create table public.feed_impressions_default partition of public.feed_impressions default;

alter table public.feed_impressions enable row level security;
alter table public.feed_impressions force row level security;
alter table public.feed_impressions_default enable row level security;
alter table public.feed_impressions_default force row level security;

-- A member logs their own impressions and reads nothing back. Partitions carry no policy
-- and no grant: they are reached only through the parent.
create policy feed_impressions_insert_self on public.feed_impressions
  for insert to authenticated
  with check (user_id = (select auth.uid()));

-- The device sends post ids only; the member and the time are filled by the defaults.
grant insert (post_id) on public.feed_impressions to authenticated;

-- Creates the partition holding the month of p_month, if it is missing. Called ahead of
-- time by the scheduled maintenance job (the month must not yet have rows in the default
-- partition); the same job drops partitions older than the retention period.
create function kc_private.feed_impressions_ensure_partition(p_month date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Month boundaries in UTC, whatever the time zone of the calling session.
  v_from constant timestamptz := date_trunc('month', p_month)::timestamp at time zone 'UTC';
  v_to constant timestamptz := (date_trunc('month', p_month) + interval '1 month')::timestamp at time zone 'UTC';
  v_name constant text := 'feed_impressions_' || to_char(p_month, 'YYYY_MM');
begin
  if to_regclass('public.' || v_name) is not null then
    return;
  end if;
  execute format(
    'create table public.%I partition of public.feed_impressions for values from (%L) to (%L)',
    v_name, v_from, v_to);
  execute format('alter table public.%I enable row level security', v_name);
  execute format('alter table public.%I force row level security', v_name);
end;
$$;
comment on function kc_private.feed_impressions_ensure_partition(date) is
  'Creates the monthly partition of feed_impressions for the given month when it is missing.';
