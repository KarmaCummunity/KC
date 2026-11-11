-- 0194_follow_edges_block_anon_read | FR-FOLLOW-* (security audit 2026-06-14, Finding 1)
--
-- Close anonymous read of the entire follow graph.
--
-- The SELECT policy follow_edges_select_visible (created in 0003) applies to role
-- `public` (which includes `anon`) and its USING clause has NO auth.uid()
-- predicate — it only checks that both endpoints exist in public.users:
--     using (exists (select 1 from users where user_id = follower_id)
--            and exists (select 1 from users where user_id = followed_id))
-- Because Supabase's default privileges grant table access to `anon` on every
-- table, an unauthenticated client holding the public anon key can SELECT every
-- (follower_id, followed_id) row, i.e. enumerate the complete social graph.
-- (Confirmed live: GET /rest/v1/follow_edges returns all edges to anon.)
--
-- Migration 0070 attempted `revoke select on public.follow_edges from anon`, but
-- the default-privilege grant keeps anon's table access alive, so the grant layer
-- is not a reliable control here — the RLS policy is. The sibling tables
-- follow_requests and blocks do not leak because their SELECT policies require
-- auth.uid() participation.
--
-- Fix: scope the SELECT policy to `authenticated`. Behaviour for signed-in users
-- is unchanged (they still see edges among visible users, subject to users RLS);
-- anonymous callers now get zero rows. Re-revoke the stray anon grants for
-- defense in depth. Follower/following COUNTS for guests already come from the
-- aggregate users_public.followers_count/following_count, not this table.

begin;

drop policy if exists follow_edges_select_visible on public.follow_edges;
create policy follow_edges_select_visible on public.follow_edges
  for select to authenticated using (
    exists (select 1 from public.users where user_id = follow_edges.follower_id)
    and exists (select 1 from public.users where user_id = follow_edges.followed_id)
  );

-- Defense in depth: anon never needs any privilege on follow_edges. No-op if the
-- grants are already absent.
revoke all on public.follow_edges from anon;

commit;
