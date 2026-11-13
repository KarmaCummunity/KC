-- Posts · who may read and write a post
--
-- Visibility is decided by indexed columns and one lookup on `follows`; no function is
-- evaluated over the row. Nothing is granted to signed-out callers.

alter table public.posts enable row level security;
alter table public.posts force row level security;

-- The owner sees their own posts in every status, whatever their account state.
create policy posts_select_owner on public.posts
  for select to authenticated
  using (owner_id = (select auth.uid()));

-- Another member sees a post when all three hold:
--   1. status — only `open` and `closed_delivered`. A delivered post stays on the giver's
--      profile as their record of giving (FR-PROFILE-001 closed tab, FR-POST-021). Drafts,
--      paused posts (D104), posts closed without a recipient, expired posts and posts hidden
--      or removed by moderation are the owner's alone.
--   2. audience — `Public`, or `FollowersOnly` when the viewer follows the owner. `OnlyMe`
--      never matches.
--   3. owner — the owner's profile is visible to the viewer. The subquery runs under the
--      viewer's own access to `users`, so it inherits that table's rules: the owner's
--      account is active and no block exists between the two, in either direction.
-- Extension points (later modules add policies; this one does not change): moderators read
-- every post; the counterparty of a handoff reads the post whatever its audience; a
-- member's own report hides the post from them (restrictive policy).
create policy posts_select_visible on public.posts
  for select to authenticated
  using (
    status in ('open', 'closed_delivered')
    and (visibility = 'Public'
         or (visibility = 'FollowersOnly'
             and exists (select 1 from public.follows f
                          where f.follower_id = (select auth.uid()) and f.followed_id = posts.owner_id)))
    and exists (select 1 from public.users u where u.id = posts.owner_id));

-- A member creates their own post, as a draft or already open, written in the product
-- (never 'imported'). A member whose account is not active cannot post (spec 7.1, S2).
create policy posts_insert_owner on public.posts
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and status in ('draft', 'open')
    and exists (select 1 from public.users u where u.id = (select auth.uid()) and u.is_active));

-- The owner edits content while the post is a draft, open or paused; once closed, expired
-- or under moderation the content is locked (D104). Which columns is decided by the grant.
create policy posts_update_owner on public.posts
  for update to authenticated
  using (
    owner_id = (select auth.uid())
    and status in ('draft', 'open', 'paused')
    and exists (select 1 from public.users u where u.id = (select auth.uid()) and u.is_active))
  with check (owner_id = (select auth.uid()));

-- Only a draft is ever deleted from a device: it was never published, so nobody else holds
-- a record of it. Removing a published post is a status move (`deleted_no_recipient`) made
-- by an RPC, and the row is purged by a server job after its grace period (design §4.1).
create policy posts_delete_owner_draft on public.posts
  for delete to authenticated
  using (owner_id = (select auth.uid()) and status = 'draft');

grant select, delete on public.posts to authenticated;

-- Insert: everything the create form sets. Status is limited to draft / open by the policy.
-- Not insertable: beneficiary_org_id, expires_at, source, source_language, geo_approx,
-- status_before_removal, published_at, timestamps — all server-written.
grant insert (
  id, owner_id, world_slug, kind_id, post_type, direction, status, visibility, title, description,
  item_subcategory_id, details, city_id, location_display_level, time_window, urgency_level
) on public.posts to authenticated;

-- Update: content only. The owner, world, kind, post type and direction are fixed at
-- creation (FR-POST-008 AC2); status moves through RPCs; derived columns are never writable.
grant update (
  visibility, title, description, item_subcategory_id, details, city_id, location_display_level,
  time_window, urgency_level
) on public.posts to authenticated;
