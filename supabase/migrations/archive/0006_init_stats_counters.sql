-- 0006_init_stats_counters | P0.2.f — Stats projections + counter triggers + community_stats view
-- FR-STATS-001..006, FR-PROFILE-013, FR-FEED-014+015, FR-CLOSURE-008 (data shape only), FR-PROFILE-001 AC2
--
-- Counters live as denormalised columns on `public.users`. Ground truth is the
-- mutating tables (posts, recipients, follow_edges); these triggers keep the
-- denorm in sync. All trigger functions are SECURITY DEFINER because the
-- column-grant on `users` (0001 §grant update) intentionally forbids clients
-- from writing counters. FR-STATS-005's nightly drift recompute job is the
-- higher-fidelity reconciliation; this migration is the per-event projection.
--
-- FR-PROFILE-013 is viewer-dependent (FollowersOnly counts only when viewer is
-- an approved follower) and cannot be condensed to a single column. We store
-- TWO columns (public_open + followers_only_open) and expose
-- `active_posts_count_for_viewer(owner, viewer)` for the viewer-aware total.

-- ── 1. Schema additions on public.users ─────────────────────────────────────
alter table public.users
  add column if not exists active_posts_count_public_open          integer not null default 0
    check (active_posts_count_public_open >= 0),
  add column if not exists active_posts_count_followers_only_open  integer not null default 0
    check (active_posts_count_followers_only_open >= 0),
  add column if not exists posts_created_total                     integer not null default 0
    check (posts_created_total >= 0);

-- Hot-path index for FR-FEED-015 (first-post nudge): fast existence probe for
-- "this user has never posted and hasn't dismissed the card".
create index if not exists users_first_post_nudge_idx
  on public.users (user_id)
  where posts_created_total = 0 and first_post_nudge_dismissed = false;

-- FR-CLOSURE-008 supporting index. The bg-job's query is:
--   delete from posts where status = 'deleted_no_recipient' and delete_after < now();
-- Partial index keeps this narrow.
create index if not exists posts_pending_hard_delete_idx
  on public.posts (delete_after)
  where status = 'deleted_no_recipient' and delete_after is not null;

-- ── 2. Helper: clamp-at-zero decrement ──────────────────────────────────────
-- FR-STATS-002 AC4 — counters never go below zero. The clamp is the schema's
-- last line of defence; FR-STATS-005 (nightly drift recompute) is the higher-
-- fidelity reconciliation. We raise NOTICE on clamp so drift events are
-- visible in pg logs and can later feed an SRE alert (NFR-RELI-005).
create or replace function public.stats_safe_dec(p_value integer)
returns integer
language plpgsql
immutable
as $$
begin
  if p_value <= 0 then
    raise notice 'stats counter would go below zero — clamped';
    return 0;
  end if;
  return p_value - 1;
end;
$$;

-- ── 3. posts triggers (INSERT / UPDATE status,visibility / DELETE) ──────────
-- One unified function so all transition accounting lives in one place.
-- Branches on TG_OP. Status delta and visibility delta are handled
-- independently, but visibility-shift is no-op when status changed in the same
-- UPDATE (the status branch already used old.visibility for the −1 leg and
-- new.visibility for the +1 leg).
create or replace function public.posts_after_change_counters()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_was_open  boolean;
  v_now_open  boolean;
  v_owner     uuid;
begin
  -- ── INSERT ──────────────────────────────────────────────────────────────
  if tg_op = 'INSERT' then
    update public.users
       set posts_created_total = posts_created_total + 1
     where user_id = new.owner_id;

    if new.status = 'open' then
      update public.users
         set active_posts_count_internal = active_posts_count_internal + 1,
             active_posts_count_public_open = active_posts_count_public_open
               + case when new.visibility = 'Public' then 1 else 0 end,
             active_posts_count_followers_only_open = active_posts_count_followers_only_open
               + case when new.visibility = 'FollowersOnly' then 1 else 0 end
       where user_id = new.owner_id;
    elsif new.status in ('closed_delivered', 'deleted_no_recipient') then
      -- Edge case: post seeded directly in a closed state (admin tooling /
      -- backfill). Mirror the +1 that a normal open→closed transition gives.
      update public.users
         set items_given_count = items_given_count + 1
       where user_id = new.owner_id;
    end if;
    return null;
  end if;

  -- ── DELETE ──────────────────────────────────────────────────────────────
  -- Hard delete (bg-job-soft-delete-cleanup, admin tooling) only rolls back
  -- active-posts. items_given is intentionally NOT touched — the symmetric
  -- accounting lives on status transitions; FR-STATS-005 reconciles drift.
  if tg_op = 'DELETE' then
    if old.status = 'open' then
      update public.users
         set active_posts_count_internal = public.stats_safe_dec(active_posts_count_internal),
             active_posts_count_public_open = case
               when old.visibility = 'Public'
               then public.stats_safe_dec(active_posts_count_public_open)
               else active_posts_count_public_open
             end,
             active_posts_count_followers_only_open = case
               when old.visibility = 'FollowersOnly'
               then public.stats_safe_dec(active_posts_count_followers_only_open)
               else active_posts_count_followers_only_open
             end
       where user_id = old.owner_id;
    end if;
    return null;
  end if;

  -- ── UPDATE: status / visibility deltas ─────────────────────────────────
  v_owner    := new.owner_id;
  v_was_open := old.status = 'open';
  v_now_open := new.status = 'open';

  -- 3a. Status delta — affects active_posts_* and items_given_count.
  if old.status is distinct from new.status then
    if v_was_open and not v_now_open then
      update public.users
         set active_posts_count_internal = public.stats_safe_dec(active_posts_count_internal),
             active_posts_count_public_open = case
               when old.visibility = 'Public'
               then public.stats_safe_dec(active_posts_count_public_open)
               else active_posts_count_public_open
             end,
             active_posts_count_followers_only_open = case
               when old.visibility = 'FollowersOnly'
               then public.stats_safe_dec(active_posts_count_followers_only_open)
               else active_posts_count_followers_only_open
             end
       where user_id = v_owner;
    elsif v_now_open and not v_was_open then
      update public.users
         set active_posts_count_internal = active_posts_count_internal + 1,
             active_posts_count_public_open = active_posts_count_public_open
               + case when new.visibility = 'Public' then 1 else 0 end,
             active_posts_count_followers_only_open = active_posts_count_followers_only_open
               + case when new.visibility = 'FollowersOnly' then 1 else 0 end
       where user_id = v_owner;
    end if;

    -- items_given_count (FR-STATS-002 AC1):
    --  +1: open → {closed_delivered | deleted_no_recipient}
    --  −1: {closed_delivered | deleted_no_recipient} → open  (reopen)
    -- Other transitions (expired, removed_admin) do NOT touch items_given.
    if v_was_open and new.status in ('closed_delivered', 'deleted_no_recipient') then
      update public.users
         set items_given_count = items_given_count + 1
       where user_id = v_owner;
    elsif old.status in ('closed_delivered', 'deleted_no_recipient') and v_now_open then
      update public.users
         set items_given_count = public.stats_safe_dec(items_given_count)
       where user_id = v_owner;
    end if;
  end if;

  -- 3b. Visibility delta — only meaningful when the post stays in `open`. If
  -- status changed in the same UPDATE, 3a already accounted for both visibility
  -- buckets correctly using old.visibility (−1) and new.visibility (+1).
  if v_was_open and v_now_open and old.visibility is distinct from new.visibility then
    if old.visibility = 'Public' then
      update public.users
         set active_posts_count_public_open = public.stats_safe_dec(active_posts_count_public_open)
       where user_id = v_owner;
    elsif old.visibility = 'FollowersOnly' then
      update public.users
         set active_posts_count_followers_only_open = public.stats_safe_dec(active_posts_count_followers_only_open)
       where user_id = v_owner;
    end if;

    if new.visibility = 'Public' then
      update public.users
         set active_posts_count_public_open = active_posts_count_public_open + 1
       where user_id = v_owner;
    elsif new.visibility = 'FollowersOnly' then
      update public.users
         set active_posts_count_followers_only_open = active_posts_count_followers_only_open + 1
       where user_id = v_owner;
    end if;
  end if;

  return null;
end;
$$;

create trigger posts_after_insert_counters
  after insert on public.posts
  for each row execute function public.posts_after_change_counters();

create trigger posts_after_update_counters
  after update of status, visibility on public.posts
  for each row execute function public.posts_after_change_counters();

create trigger posts_after_delete_counters
  after delete on public.posts
  for each row execute function public.posts_after_change_counters();

-- ── 4. recipients triggers — items_received_count ───────────────────────────
-- FR-STATS-002 AC2: +1 on Recipient row create, −1 on delete (un-mark, reopen,
-- post removal cascade). Owner-side items_given_count is NOT touched here —
-- it lives on the post status transition (§3) so closed-without-recipient
-- still correctly counts.
create or replace function public.recipients_after_insert_counters()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.users
     set items_received_count = items_received_count + 1
   where user_id = new.recipient_user_id;
  return null;
end;
$$;

create trigger recipients_after_insert_counters
  after insert on public.recipients
  for each row execute function public.recipients_after_insert_counters();

create or replace function public.recipients_after_delete_counters()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.users
     set items_received_count = public.stats_safe_dec(items_received_count)
   where user_id = old.recipient_user_id;
  return null;
end;
$$;

create trigger recipients_after_delete_counters
  after delete on public.recipients
  for each row execute function public.recipients_after_delete_counters();

-- ── 5. follow_edges triggers — followers_count / following_count ────────────
-- FR-PROFILE-001 AC2 surfaces these on the profile header. INSERTs come from
-- direct follows (Public profiles) and from follow_requests acceptance
-- (`follow_requests_on_accept_create_edge`, 0003 §13). DELETEs come from
-- unfollow, remove-follower, account deletion cascade, and block side-effect
-- (`blocks_apply_side_effects`, 0003 §14).
create or replace function public.follow_edges_after_insert_counters()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.users
     set followers_count = followers_count + 1
   where user_id = new.followed_id;
  update public.users
     set following_count = following_count + 1
   where user_id = new.follower_id;
  return null;
end;
$$;

create trigger follow_edges_after_insert_counters
  after insert on public.follow_edges
  for each row execute function public.follow_edges_after_insert_counters();

create or replace function public.follow_edges_after_delete_counters()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.users
     set followers_count = public.stats_safe_dec(followers_count)
   where user_id = old.followed_id;
  update public.users
     set following_count = public.stats_safe_dec(following_count)
   where user_id = old.follower_id;
  return null;
end;
$$;

create trigger follow_edges_after_delete_counters
  after delete on public.follow_edges
  for each row execute function public.follow_edges_after_delete_counters();

-- ── 6. Viewer-aware active-posts function (FR-PROFILE-013) ──────────────────
-- Self viewer  → active_posts_count_internal (includes Only-me).
-- Other viewer → public_open + (followers_only_open if approved follower).
-- The function NEVER reveals to a non-owner that the owner has hidden Only-me
-- posts (FR-PROFILE-013 AC4). SECURITY DEFINER so it can read counter columns
-- regardless of the caller's RLS view.
create or replace function public.active_posts_count_for_viewer(
  p_owner   uuid,
  p_viewer  uuid
)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_internal      integer;
  v_public_open   integer;
  v_followers     integer;
  v_is_follower   boolean := false;
begin
  if p_owner is null then
    return 0;
  end if;

  if p_viewer is not null and p_owner = p_viewer then
    select active_posts_count_internal
      into v_internal
      from public.users
     where user_id = p_owner;
    return coalesce(v_internal, 0);
  end if;

  if p_viewer is not null then
    v_is_follower := public.is_following(p_viewer, p_owner);
  end if;

  select active_posts_count_public_open,
         active_posts_count_followers_only_open
    into v_public_open, v_followers
    from public.users
   where user_id = p_owner;

  return coalesce(v_public_open, 0)
       + case when v_is_follower then coalesce(v_followers, 0) else 0 end;
end;
$$;

grant execute on function public.active_posts_count_for_viewer(uuid, uuid)
  to anon, authenticated;

-- ── 7. community_stats view (FR-STATS-004 + FR-FEED-014) ────────────────────
-- Three aggregates exposed via a single view. Edge caching (60s, per
-- FR-STATS-004 AC2) is the SRS contract for staleness; the view itself is
-- always fresh. All three counts hit partial indexes from 0001/0002, so MVP
-- scale doesn't justify a materialised view + refresh job. Promote to MV when
-- the table sizes warrant it; callers won't change.
create or replace view public.community_stats as
  select
    (select count(*) from public.users
       where account_status = 'active')                           as registered_users,
    (select count(*) from public.posts
       where status = 'open' and visibility = 'Public')           as active_public_posts,
    (select count(*) from public.posts
       where status = 'closed_delivered')                         as items_delivered_total,
    now()                                                         as as_of;

-- FR-STATS-006 AC2 — community stats accessible to any authenticated user.
-- FR-FEED-014 AC1 — guest peek (`anon` role) needs the active-posts number too.
grant select on public.community_stats to anon, authenticated;

-- ── 8. Backfill ─────────────────────────────────────────────────────────────
-- Idempotent recompute from ground truth. Lets the migration land cleanly even
-- after rows already exist (e.g., users created via 0001 + posts/edges seeded
-- in development). FR-STATS-005's nightly job is the durable equivalent.
update public.users u set
  active_posts_count_public_open         = coalesce(p.public_open, 0),
  active_posts_count_followers_only_open = coalesce(p.followers_only_open, 0),
  active_posts_count_internal            = coalesce(p.internal_open, 0),
  posts_created_total                    = coalesce(p.total, 0),
  items_given_count                      = coalesce(p.given, 0)
from (
  select owner_id,
         count(*) filter (where status = 'open' and visibility = 'Public')        as public_open,
         count(*) filter (where status = 'open' and visibility = 'FollowersOnly') as followers_only_open,
         count(*) filter (where status = 'open')                                  as internal_open,
         count(*)                                                                 as total,
         count(*) filter (where status in ('closed_delivered','deleted_no_recipient')) as given
    from public.posts
   group by owner_id
) p
where u.user_id = p.owner_id;

update public.users u set
  items_received_count = coalesce(r.received, 0)
from (
  select recipient_user_id, count(*) as received
    from public.recipients
   group by recipient_user_id
) r
where u.user_id = r.recipient_user_id;

update public.users u set
  followers_count = coalesce(f.followers, 0),
  following_count = coalesce(f.following, 0)
from (
  select user_id,
         sum(case when role = 'followed' then 1 else 0 end) as followers,
         sum(case when role = 'follower' then 1 else 0 end) as following
    from (
      select followed_id as user_id, 'followed'::text as role from public.follow_edges
      union all
      select follower_id as user_id, 'follower'::text as role from public.follow_edges
    ) x
   group by user_id
) f
where u.user_id = f.user_id;

-- end of 0006_init_stats_counters
