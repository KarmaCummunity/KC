-- Community numbers for guests (FR-STATS-004, FR-STATS-006 AC2, FR-FEED-014).
--
-- The public About page shows the community counters to visitors who have not signed in, but
-- `community_stats()` was open to signed-in members only: every guest read failed with
-- "permission denied for function" (Sentry KC-3, 22 users in five hours). The function returns
-- three counts from one stored row and identifies nobody, so it is safe to open to guests
-- (PM decision, 2026-11-12). Only the caller check goes away; the function stays
-- security definer with an empty search path and still reads nothing but that row.
create or replace function public.community_stats()
returns table (registered_users bigint, open_public_posts bigint, delivered_posts bigint, refreshed_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(s.registered_users, 0), coalesce(s.open_public_posts, 0),
         coalesce(s.delivered_posts, 0), s.refreshed_at
    from (select 1) one
    left join kc_private.community_stats s on true;
$$;
comment on function public.community_stats() is
  'Community-wide counters: active members, open public posts, delivered posts. Counts only; open to guests.';

grant execute on function public.community_stats() to anon;
