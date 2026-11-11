-- 0069_privacy_mode_follow_approval_only | D-21 — reframe privacy_mode as a pure follow-approval flag.
--
-- Background. The previous policy pair on public.users — `users_select_public`
-- (admits only `privacy_mode = 'Public'`) and `users_select_private_approved_follower`
-- (admits Private rows only to approved followers) — implemented an
-- Instagram-style "Private profile is hidden from non-followers" semantics.
-- That created two surfaced bugs:
--   1. A Private user's Public-visibility post is returned by `posts` RLS to
--      any viewer, but the joined users row is filtered out by RLS, so the
--      publisher field falls back to "משתמש שנמחק" in
--      `apps/.../infrastructure-supabase/src/posts/mapPostRow.ts`.
--   2. Private users vanish from search-users results entirely because the
--      same policy hides them from non-followers in `users` SELECT.
--
-- Per D-21, `privacy_mode = 'Private'` means ONE thing: new follow attempts
-- create a `pending` follow request that the target must approve. Profile
-- identity, biography, counters, posts (subject to per-post `visibility`),
-- and follow-edge lists are visible to all viewers, exactly as for Public.
--
-- This migration replaces the two privacy-aware SELECT policies on
-- public.users with a single `users_select_active` policy gated only by
-- `account_status = 'active'` AND not-blocked.
--
-- Out of scope.
--   - `users_select_self` is kept as-is (owner reads own row regardless of
--     account_status).
--   - `users_select_chat_counterpart` (0012) is kept — it still lets chat
--     partners see each other when one side is `pending_verification` or
--     `suspended`. Redundant for active users under the new policy, but the
--     chat case needs to keep working when status is not 'active'.
--   - `follow_edges_select_visible` (0003) delegates to `users` RLS via
--     EXISTS subqueries. With this change, those subqueries return rows for
--     every active endpoint, so follow_edges become visible whenever both
--     endpoints are active. That is the intended D-21 behavior — the
--     followers/following lists of a Private user are now visible to all.
--   - `is_post_visible_to` (0002 / 0003) still gates by per-post visibility
--     (Public / OnlyMe / FollowersOnly) and follow-edge — independent of
--     author privacy. No change needed.
--   - `users_after_privacy_mode_change` (0023 / 0032) keeps the
--     auto-approve-pending-on-Public semantics from FR-PROFILE-006. No change.
--   - The `posts_insert_self` check that "FollowersOnly visibility requires
--     the author to be Private" (0002 line 205) is left untouched in this
--     migration; revisit under a separate TD if D-21 motivates dropping it.

-- ── 1. Drop the privacy-mode-aware SELECT policies ──────────────────────────
drop policy if exists users_select_public                       on public.users;
drop policy if exists users_select_private_approved_follower    on public.users;

-- ── 2. New SELECT policy — active + not-blocked ─────────────────────────────
-- D-21 — visibility is no longer gated by privacy_mode. Any signed-in or anon
-- viewer can read any active user's row, except when the target has blocked
-- the viewer (when blocking is reintroduced post-MVP per EXEC-9 the
-- `is_blocked` helper is wired in; today it short-circuits to false).
create policy users_select_active on public.users
  for select
  using (
    account_status = 'active'
    and not public.is_blocked(auth.uid(), user_id)
  );

-- ── 3. Sanity check ─────────────────────────────────────────────────────────
-- Confirm the two old policies are gone and the new one exists. Failing this
-- query rolls back the transaction so no half-applied state escapes.
do $$
declare
  v_count integer;
begin
  select count(*) into v_count
    from pg_policies
   where schemaname = 'public'
     and tablename  = 'users'
     and policyname in (
       'users_select_public',
       'users_select_private_approved_follower'
     );
  if v_count <> 0 then
    raise exception
      'D-21 migration: expected 0 of the old privacy SELECT policies to remain, found %', v_count;
  end if;

  select count(*) into v_count
    from pg_policies
   where schemaname = 'public'
     and tablename  = 'users'
     and policyname = 'users_select_active';
  if v_count <> 1 then
    raise exception
      'D-21 migration: expected exactly 1 users_select_active policy, found %', v_count;
  end if;
end $$;
