-- 0003_init_following_blocking | P0.2.c — Following & Blocking
-- FR-FOLLOW-001..006+008+009+012, FR-MOD-003+004+009, FR-PROFILE-003
--
-- Closes placeholders left in 0002_init_posts.sql:
--   - is_post_visible_to(): FollowersOnly branch wired against follow_edges,
--     and a block-aware short-circuit added for every branch.
--   - users RLS: SELECT policy added for approved followers of Private profiles,
--     and the existing public-SELECT policy gains the block check.

-- ── 1. follow_edges ──────────────────────────────────────────────────────────
-- Directed edge "follower follows followed". Hard-deleted on unfollow,
-- on remove-follower, and as a side-effect of block (FR-MOD-003 AC4).
create table if not exists public.follow_edges (
  follower_id  uuid not null references public.users(user_id) on delete cascade,
  followed_id  uuid not null references public.users(user_id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (follower_id, followed_id),
  constraint follow_edges_no_self check (follower_id <> followed_id)
);

create index follow_edges_followed_idx on public.follow_edges (followed_id, created_at desc);
create index follow_edges_follower_idx on public.follow_edges (follower_id, created_at desc);

-- ── 2. follow_requests ───────────────────────────────────────────────────────
-- Pending → accepted | rejected | cancelled. Per the SRS (Domain 3.2.8) the
-- composite key includes created_at so multiple historical requests between the
-- same pair are preserved for audit. A partial UNIQUE INDEX guarantees there is
-- at most ONE pending row at any time per (requester, target) pair, which lets
-- the application layer rely on a clean "is there a pending request?" query.
create table if not exists public.follow_requests (
  requester_id    uuid not null references public.users(user_id) on delete cascade,
  target_id       uuid not null references public.users(user_id) on delete cascade,
  status          text not null default 'pending'
    check (status in ('pending','accepted','rejected','cancelled')),
  cooldown_until  timestamptz,
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  primary key (requester_id, target_id, created_at),
  constraint follow_requests_no_self check (requester_id <> target_id),
  -- cooldown_until only meaningful for `rejected`; null otherwise.
  constraint follow_requests_cooldown_only_for_rejected check (
    cooldown_until is null or status = 'rejected'
  )
);

-- At most one pending request per ordered pair.
create unique index follow_requests_one_pending_per_pair_idx
  on public.follow_requests (requester_id, target_id)
  where status = 'pending';

create index follow_requests_target_pending_idx
  on public.follow_requests (target_id, created_at desc)
  where status = 'pending';

create index follow_requests_requester_pending_idx
  on public.follow_requests (requester_id, created_at desc)
  where status = 'pending';

-- ── 3. blocks ────────────────────────────────────────────────────────────────
-- Directed row, but the visibility check `is_blocked` is bilateral. Either party
-- creating a row hides each from the other (FR-MOD-009 AC3).
create table if not exists public.blocks (
  blocker_id  uuid not null references public.users(user_id) on delete cascade,
  blocked_id  uuid not null references public.users(user_id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_no_self check (blocker_id <> blocked_id)
);

create index blocks_blocked_idx on public.blocks (blocked_id);

-- ── 4. is_blocked() — bilateral predicate ────────────────────────────────────
-- Used by every visibility surface (users, posts, follow_edges, future chat).
-- NULL-safe: anonymous viewers are never blocked. STABLE so the planner can
-- inline in WHERE clauses and policies without re-evaluating per row.
-- SECURITY DEFINER so callers can probe BOTH directions of the block table even
-- when RLS would only let them see their own outgoing blocks (`blocks` SELECT
-- policy is `auth.uid() = blocker_id`). Without DEFINER, a viewer V could not
-- detect that user X has blocked them, and `is_blocked(V, X)` would return false
-- when in fact a hide should apply.
create or replace function public.is_blocked(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when a is null or b is null or a = b then false
    else exists (
      select 1 from public.blocks
      where (blocker_id = a and blocked_id = b)
         or (blocker_id = b and blocked_id = a)
    )
  end;
$$;

-- ── 5. is_following() — directed predicate ───────────────────────────────────
-- Convenience helper. Returns true iff `follower` follows `followed`.
-- SECURITY DEFINER for the same reason as is_blocked: when checking visibility
-- of a Private profile, we need to read follow_edges from the perspective of
-- the underlying table, NOT through follow_edges RLS — which itself depends on
-- users RLS, which depends on this function (chicken-and-egg).
create or replace function public.is_following(follower uuid, followed uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when follower is null or followed is null or follower = followed then false
    else exists (
      select 1 from public.follow_edges
      where follower_id = follower and followed_id = followed
    )
  end;
$$;

-- ── 6. is_post_visible_to() — refresh body to use real follow + block ────────
-- Replaces the placeholder body from 0002_init_posts.sql §6. Same signature, so
-- all RLS policies + repository queries that already call this function pick up
-- the new behaviour with no further changes.
create or replace function public.is_post_visible_to(p_post public.posts, p_viewer uuid)
returns boolean
language sql
stable
as $$
  select case
    -- Owner always sees their own row, regardless of status / visibility.
    when p_post.owner_id = p_viewer then true
    -- Block short-circuit: bilateral. Applies to every other branch.
    when public.is_blocked(p_viewer, p_post.owner_id) then false
    -- Tomb/admin states are owner-only views.
    when p_post.status in ('removed_admin','deleted_no_recipient','expired') then false
    -- Closed: visible to the recipient (FR-POST-017).
    when p_post.status = 'closed_delivered' then exists (
      select 1 from public.recipients r
      where r.post_id = p_post.post_id and r.recipient_user_id = p_viewer
    )
    -- Open posts: visibility-driven.
    when p_post.status = 'open' and p_post.visibility = 'Public' then true
    when p_post.status = 'open' and p_post.visibility = 'OnlyMe' then false
    when p_post.status = 'open' and p_post.visibility = 'FollowersOnly' then
      public.is_following(p_viewer, p_post.owner_id)
    else false
  end;
$$;

-- ── 7. users RLS — block-aware Public + approved-follower Private ────────────
-- Replace the existing `users_select_public` policy so the public projection
-- excludes counterparts that block the viewer (FR-MOD-009 AC1). Add a parallel
-- `users_select_private_approved_follower` for FR-PROFILE-003.
drop policy if exists users_select_public on public.users;

create policy users_select_public on public.users
  for select
  using (
    privacy_mode = 'Public'
    and account_status = 'active'
    and not public.is_blocked(auth.uid(), user_id)
  );

create policy users_select_private_approved_follower on public.users
  for select
  using (
    privacy_mode = 'Private'
    and account_status = 'active'
    and auth.uid() is not null
    and public.is_following(auth.uid(), user_id)
    and not public.is_blocked(auth.uid(), user_id)
  );

-- The existing `users_select_self` policy is kept as-is — owners always see
-- their own row.

-- ── 8. follow_edges RLS ──────────────────────────────────────────────────────
alter table public.follow_edges enable row level security;

-- SELECT: any edge whose endpoints are themselves visible to the viewer per
-- the users RLS. This delegates "can I see profile X?" to the policies above:
--   - Both endpoints public+active and not blocked → edge visible.
--   - Endpoint is the viewer's own row → edge visible (own follows / followers).
--   - Endpoint is private but viewer is approved follower → edge visible.
-- Block-pair edges are filtered automatically because both subqueries return 0
-- when the viewer cannot see the relevant user.
create policy follow_edges_select_visible on public.follow_edges
  for select
  using (
    exists (select 1 from public.users where user_id = follow_edges.follower_id)
    and exists (select 1 from public.users where user_id = follow_edges.followed_id)
  );

-- INSERT: only the follower may create the edge (FR-FOLLOW-001 AC1 / AC5).
-- Validation trigger below blocks self-follow + blocked-relationship.
create policy follow_edges_insert_self on public.follow_edges
  for insert
  with check (auth.uid() = follower_id);

-- DELETE: either party may remove the edge (unfollow OR remove-follower).
create policy follow_edges_delete_participants on public.follow_edges
  for delete
  using (auth.uid() in (follower_id, followed_id));

-- ── 9. follow_requests RLS ───────────────────────────────────────────────────
alter table public.follow_requests enable row level security;

-- SELECT: requester + target only. Hides the cooldown timer and rejection
-- existence from anyone else (R-MVP-Privacy-12).
create policy follow_requests_select_participants on public.follow_requests
  for select
  using (auth.uid() in (requester_id, target_id));

-- INSERT: only the requester. Trigger enforces no-block + cooldown invariants.
create policy follow_requests_insert_self on public.follow_requests
  for insert
  with check (
    auth.uid() = requester_id
    and status = 'pending'
  );

-- UPDATE — split by role:
--   target accepts or rejects a pending row;
--   requester cancels a pending row.
-- Each policy is narrow: USING limits which rows are addressable; WITH CHECK
-- limits which post-update states are allowed. Combined with the BEFORE UPDATE
-- trigger this enforces the FR-FOLLOW-004/005/006 state machine end-to-end.
create policy follow_requests_update_target on public.follow_requests
  for update
  using (auth.uid() = target_id and status = 'pending')
  with check (status in ('accepted','rejected'));

create policy follow_requests_update_requester on public.follow_requests
  for update
  using (auth.uid() = requester_id and status = 'pending')
  with check (status = 'cancelled');

-- ── 10. blocks RLS ───────────────────────────────────────────────────────────
alter table public.blocks enable row level security;

create policy blocks_select_self on public.blocks
  for select
  using (auth.uid() = blocker_id);

create policy blocks_insert_self on public.blocks
  for insert
  with check (
    auth.uid() = blocker_id
    and blocker_id <> blocked_id
  );

create policy blocks_delete_self on public.blocks
  for delete
  using (auth.uid() = blocker_id);

-- ── 11. follow_edges validation (no self / no blocked) ───────────────────────
create or replace function public.follow_edges_validate_before_insert()
returns trigger
language plpgsql
as $$
begin
  if new.follower_id = new.followed_id then
    raise exception 'self_follow_forbidden'
      using errcode = 'check_violation';
  end if;
  if public.is_blocked(new.follower_id, new.followed_id) then
    raise exception 'blocked_relationship'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger follow_edges_before_insert
  before insert on public.follow_edges
  for each row execute function public.follow_edges_validate_before_insert();

-- ── 12. follow_requests validation (no self / no blocked / cooldown / no edge)─
create or replace function public.follow_requests_validate_before_insert()
returns trigger
language plpgsql
as $$
declare
  active_cooldown_until timestamptz;
begin
  if new.requester_id = new.target_id then
    raise exception 'self_follow_request_forbidden'
      using errcode = 'check_violation';
  end if;
  if public.is_blocked(new.requester_id, new.target_id) then
    raise exception 'blocked_relationship'
      using errcode = 'check_violation';
  end if;
  -- An existing edge means there is nothing to request.
  if public.is_following(new.requester_id, new.target_id) then
    raise exception 'already_following'
      using errcode = 'check_violation';
  end if;
  -- 14-day cooldown after the most recent rejection (FR-FOLLOW-006 AC1).
  select max(cooldown_until) into active_cooldown_until
  from public.follow_requests
  where requester_id = new.requester_id
    and target_id   = new.target_id
    and status      = 'rejected'
    and cooldown_until is not null
    and cooldown_until > now();
  if active_cooldown_until is not null then
    raise exception 'follow_request_cooldown_active'
      using errcode = 'check_violation',
            detail  = 'cooldown_until=' || active_cooldown_until::text;
  end if;
  return new;
end;
$$;

create trigger follow_requests_before_insert
  before insert on public.follow_requests
  for each row execute function public.follow_requests_validate_before_insert();

-- ── 13. follow_requests state-change side-effects ─────────────────────────────
-- Stamps the 14-day cooldown when status transitions to `rejected`, and stamps
-- `resolved_at` for any non-pending status. (Cancellation by the requester does
-- NOT set a cooldown — only target-side rejection does, per FR-FOLLOW-004 AC2.)
create or replace function public.follow_requests_on_status_change()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'pending' and new.status <> 'pending' then
    new.resolved_at := now();
    if new.status = 'rejected' then
      new.cooldown_until := now() + interval '14 days';
    end if;
  end if;
  return new;
end;
$$;

create trigger follow_requests_set_cooldown
  before update of status on public.follow_requests
  for each row execute function public.follow_requests_on_status_change();

-- On accept: atomically create the matching follow_edge (FR-FOLLOW-005 AC1).
-- SECURITY DEFINER so the insert bypasses follow_edges RLS — the row-level
-- check (auth.uid() = follower_id) cannot succeed here because the inserter
-- is the *target*, not the follower.
create or replace function public.follow_requests_on_accept_create_edge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'pending' and new.status = 'accepted' then
    insert into public.follow_edges (follower_id, followed_id)
    values (new.requester_id, new.target_id)
    on conflict do nothing;
  end if;
  return new;
end;
$$;

create trigger follow_requests_after_accept
  after update of status on public.follow_requests
  for each row execute function public.follow_requests_on_accept_create_edge();

-- ── 14. blocks side-effects (FR-MOD-003 AC4) ─────────────────────────────────
-- After a block is created, hard-delete follow edges in BOTH directions and
-- cancel any pending follow requests in BOTH directions. Idempotent: re-running
-- with no edges/requests is a no-op.
-- SECURITY DEFINER so the cleanup runs regardless of the blocker/blocked RLS
-- standing (the blocked party might be private + not approved follower).
create or replace function public.blocks_apply_side_effects()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.follow_edges
  where (follower_id = new.blocker_id and followed_id = new.blocked_id)
     or (follower_id = new.blocked_id and followed_id = new.blocker_id);

  update public.follow_requests
  set status      = 'cancelled',
      resolved_at = now()
  where status = 'pending'
    and ((requester_id = new.blocker_id and target_id = new.blocked_id)
      or (requester_id = new.blocked_id and target_id = new.blocker_id));

  return new;
end;
$$;

create trigger blocks_after_insert_side_effects
  after insert on public.blocks
  for each row execute function public.blocks_apply_side_effects();

-- ── 15. Grants ──────────────────────────────────────────────────────────────
-- Per-column grants for `follow_requests`: clients may write status only via
-- the role-scoped policies + trigger above; cooldown_until / resolved_at /
-- created_at are server-managed.
grant select          on public.follow_edges    to anon, authenticated;
grant insert, delete  on public.follow_edges    to authenticated;

grant select          on public.follow_requests to authenticated;
grant insert          on public.follow_requests to authenticated;
grant update (status) on public.follow_requests to authenticated;

grant select          on public.blocks          to authenticated;
grant insert, delete  on public.blocks          to authenticated;
