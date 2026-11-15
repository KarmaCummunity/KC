-- 0643_feed_hide_inactive_owners | FR-FEED-001 / FR-POST-021: hide posts whose owner is not an
-- active user from every non-owner surface (feed, search, RLS). Complements pending_deletion
-- (0549) for deleted / banned / suspended owners whose rows still exist.

begin;

create or replace function public.is_post_visible_to(p_post posts, p_viewer uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select case
    when p_post.owner_id = p_viewer then true
    when p_viewer is distinct from p_post.owner_id
      and not exists (
        select 1 from public.users u
        where u.user_id = p_post.owner_id and u.account_status = 'active'
      ) then false
    when public.is_account_pending_deletion(p_post.owner_id) then false
    when public.is_blocked(p_viewer, p_post.owner_id) then false
    when exists (
      select 1 from public.reporter_hides h
      where h.reporter_id = p_viewer
        and h.target_type = 'post'
        and h.target_id   = p_post.post_id
    ) then false
    when p_post.status in ('removed_admin','hidden_pending_review','deleted_no_recipient','expired') then false
    when p_post.status = 'closed_delivered' then
      case
        when exists (
          select 1 from public.recipients r
          where r.post_id = p_post.post_id
            and r.recipient_user_id = p_viewer
        ) then true
        when public.participant_closed_surface_visible(p_post, p_post.owner_id, p_viewer) then true
        when exists (
          select 1 from public.recipients r2
          where r2.post_id = p_post.post_id
            and r2.recipient_user_id is not null
            and public.participant_closed_surface_visible(p_post, r2.recipient_user_id, p_viewer)
        ) then true
        else false
      end
    when p_post.status = 'open' and p_post.visibility = 'Public' then true
    when p_post.status = 'open' and p_post.visibility = 'OnlyMe' then false
    when p_post.status = 'open' and p_post.visibility = 'FollowersOnly' then
      public.is_following(p_viewer, p_post.owner_id)
    else false
  end;
$function$;

comment on function public.is_post_visible_to(public.posts, uuid) is
  'Whether p_viewer may see p_post. Non-active owners are visible only to themselves (0643).';

commit;
