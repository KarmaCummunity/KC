-- 0541_follow_edges_private_by_request | A follow edge to a Private profile is created only
-- by an approved follow request (docs/SSOT/spec/03_following.md FR-FOLLOW-003 AC4,
-- FR-FOLLOW-005 AC1, FR-FOLLOW-012 AC2 — enforced at the data layer, not only in the app).
--
-- A member's own insert into `follow_edges` (policy `follow_edges_insert_self`) is allowed
-- only when the followed profile is Public. Edges to Private profiles keep coming from the
-- paths that already create them, all of which run as the table owner and so are not
-- subject to this policy: `follow_requests_on_accept_create_edge` (approval) and
-- `users_on_privacy_mode_change` (Private → Public auto-accepts pending requests).
-- `FollowUserUseCase` already sends a request instead of following a Private profile, so
-- the app's own flows are unchanged. Idempotent.

begin;

-- Whether a profile is Private, read regardless of the caller's visibility of that row
-- (the `users` select policies hide some rows from some viewers).
create or replace function public.is_private_profile(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.users u
     where u.user_id = p_user_id
       and u.privacy_mode = 'Private'
  );
$$;

comment on function public.is_private_profile(uuid) is
  'RLS helper: true when the profile is Private. Used by follow_edges_insert_self (0541).';

-- An RLS predicate evaluated as the signed-in member must be executable by that role (D-208).
revoke all on function public.is_private_profile(uuid) from public, anon;
grant execute on function public.is_private_profile(uuid) to authenticated;

drop policy if exists follow_edges_insert_self on public.follow_edges;
create policy follow_edges_insert_self on public.follow_edges
  for insert to public
  with check (auth.uid() = follower_id and not public.is_private_profile(followed_id));

commit;
