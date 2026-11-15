-- Moderation · what staff may read and manage
--
-- Additional policies only: nothing a member could not read before becomes readable to a
-- member, and no existing policy changes. Platform staff (support and above) read what
-- the admin screens show — members in every account state, every post, handoffs, ratings
-- and comments, removed ones included. Private details (user_private, exact addresses)
-- stay closed to staff as well. Each predicate is wrapped in a scalar subquery, so it is
-- evaluated once per statement, not per row.

-- Member search and member detail, including suspended, banned and deactivated accounts.
create policy users_select_staff on public.users
  for select to authenticated
  using ((select kc_access.is_admin()));
create policy user_account_select_staff on public.user_account
  for select to authenticated
  using ((select kc_access.is_admin()));

-- Content search and the report case screen: posts in every status and audience.
create policy posts_select_staff on public.posts
  for select to authenticated
  using ((select kc_access.is_admin()));
create policy post_handoffs_select_staff on public.post_handoffs
  for select to authenticated
  using ((select kc_access.is_admin()));
-- Comments, deleted ones included: the row is the evidence of a reported comment.
create policy post_comments_select_staff on public.post_comments
  for select to authenticated
  using ((select kc_access.is_admin()));

-- Ratings are read by staff only (D24): a member never sees a rating, their own included.
create policy post_ratings_select_staff on public.post_ratings
  for select to authenticated
  using ((select kc_access.is_admin()));
grant select on public.post_ratings to authenticated;

-- The super admin may edit the content of every post (design §12.1), in any status. Which
-- columns is decided by the grant of the posts module; status still moves only through RPCs.
create policy posts_update_super_admin on public.posts
  for update to authenticated
  using ((select kc_access.has_admin_role('super_admin')))
  with check ((select kc_access.has_admin_role('super_admin')));

-- Replaces the handoffs module's authorization of every post management action (publish,
-- pause, resume, delete, close, reopen): the owner, or the super admin for every post
-- (design §12.1).
create or replace function kc_private.can_manage_post(p_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.posts p
     where p.id = p_post_id
       and (p.owner_id = (select auth.uid())
            or kc_access.has_admin_role('super_admin')
            -- ORGANIZATIONS MODULE: add here "or the caller is an admin of p.beneficiary_org_id".
           ));
$$;
comment on function kc_private.can_manage_post(uuid) is
  'Authorization of every post management action: the owner, or the super admin.';
