-- Identity · user_stats (denormalized counters)
--
-- Counters shown on a profile. They live apart from `users` so that a follow, a reaction or a
-- new post never rewrites the profile row. Maintained by triggers in the modules that own the
-- counted rows; a nightly job recomputes them and records any drift.

create table public.user_stats (
  user_id                    uuid primary key references public.users (id) on delete cascade,
  followers_count            integer not null default 0 check (followers_count >= 0),
  following_count            integer not null default 0 check (following_count >= 0),
  items_given_count          integer not null default 0 check (items_given_count >= 0),
  items_received_count       integer not null default 0 check (items_received_count >= 0),
  -- Open posts by visibility: a viewer is shown the sum they are allowed to see.
  open_posts_public          integer not null default 0 check (open_posts_public >= 0),
  open_posts_followers_only  integer not null default 0 check (open_posts_followers_only >= 0),
  open_posts_only_me         integer not null default 0 check (open_posts_only_me >= 0),
  posts_created_total        integer not null default 0 check (posts_created_total >= 0),
  karma_points               integer not null default 0 check (karma_points >= 0),
  volunteer_hours_total      numeric(10, 2) not null default 0 check (volunteer_hours_total >= 0),
  updated_at                 timestamptz not null default now()
);
comment on table public.user_stats is 'Profile counters, maintained by triggers and reconciled nightly.';

create trigger user_stats_set_updated_at
  before update on public.user_stats
  for each row execute function kc_private.set_updated_at();

alter table public.user_stats enable row level security;
alter table public.user_stats force row level security;

-- Counters are visible exactly when the profile is: the subquery runs under the caller's
-- own access to `users`, so it inherits that table's policy.
create policy user_stats_select_visible_profile on public.user_stats
  for select to authenticated
  using (exists (select 1 from public.users u where u.id = user_stats.user_id));

-- Column grant: the private "only me" count is left out; its owner reads it through an RPC.
grant select (
  user_id, followers_count, following_count, items_given_count, items_received_count,
  open_posts_public, open_posts_followers_only, posts_created_total, karma_points,
  volunteer_hours_total, updated_at
) on public.user_stats to authenticated;
