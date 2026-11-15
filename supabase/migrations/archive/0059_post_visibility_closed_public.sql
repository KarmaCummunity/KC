-- 0059_post_visibility_closed_public.sql
-- Spec: docs/superpowers/specs/2026-05-13-closed-posts-on-both-profiles-design.md
-- FR-POST-017 AC1 (revised) — closed_delivered posts are visible to viewers
-- according to the post's `visibility` setting, mirroring open-post rules:
--   Public         → everyone (minus block + reporter-hide)
--   FollowersOnly  → approved followers
--   OnlyMe         → owner only
-- Owner and recipient always see (unchanged).
--
-- Other tomb states (removed_admin, deleted_no_recipient, expired) remain
-- owner-only — unchanged from migration 0005.

create or replace function public.is_post_visible_to(p_post public.posts, p_viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    -- Owner always sees their own row, regardless of any moderation state.
    when p_post.owner_id = p_viewer then true
    -- Block short-circuit: bilateral.
    when public.is_blocked(p_viewer, p_post.owner_id) then false
    -- Reporter-side hides apply BEFORE every other branch (FR-MOD-001 AC5).
    when exists (
      select 1 from public.reporter_hides h
      where h.reporter_id = p_viewer
        and h.target_type = 'post'
        and h.target_id   = p_post.post_id
    ) then false
    -- Tomb states (other than closed_delivered): owner-only.
    when p_post.status in ('removed_admin','deleted_no_recipient','expired') then false
    -- closed_delivered: recipient always sees; non-recipients follow visibility.
    when p_post.status = 'closed_delivered' then
      case
        when exists (
          select 1 from public.recipients r
          where r.post_id = p_post.post_id and r.recipient_user_id = p_viewer
        ) then true
        when p_post.visibility = 'Public' then true
        when p_post.visibility = 'OnlyMe' then false
        when p_post.visibility = 'FollowersOnly' then public.is_following(p_viewer, p_post.owner_id)
        else false
      end
    -- open: standard visibility ladder.
    when p_post.status = 'open' and p_post.visibility = 'Public' then true
    when p_post.status = 'open' and p_post.visibility = 'OnlyMe' then false
    when p_post.status = 'open' and p_post.visibility = 'FollowersOnly' then
      public.is_following(p_viewer, p_post.owner_id)
    else false
  end;
$$;
