-- Posts · a followers-only audience needs a private profile (FR-POST-003 AC4, FR-POST-009 AC1-AC2)
--
-- The spec offers `FollowersOnly` only to a member whose profile is `Private`: a public profile
-- has no approved-followers list to limit a post to, so the app disables that choice there.
-- `upsert_post_actor_identity` checked the opposite (it refused `FollowersOnly` unless the profile
-- was `Public`), so the only members the app offers the choice to were always refused when they
-- saved it as the audience of a post they take part in. This restores the rule the spec states
-- and names the refusal the way the app already reports it (`followers_only_requires_private`).
-- Signature, grants and every other check are unchanged.

-- Sets the caller's audience and identity mask on a post they take part in.
--   unauthenticated                       no session (42501)
--   invalid_surface_visibility            not Public / FollowersOnly / OnlyMe
--   invalid_identity_visibility           not Public / FollowersOnly / Hidden
--   post_not_found                        no such post
--   not_participant                       the caller is neither the owner nor the receiver
--   followers_only_requires_private       FollowersOnly needs a private profile (FR-POST-003 AC4, FR-POST-009 AC1)
-- The owner of a delivered post routes third-party discovery through `posts.visibility`
-- (feed, profile tabs and the read policy decide on it), so the audience is mirrored there;
-- the receiver's audience is stored for the profile surface that lists received posts.
-- `p_identity_visibility` null keeps the stored value (world default on first write).
create or replace function public.upsert_post_actor_identity(
  p_post_id uuid,
  p_surface_visibility text,
  p_hide_from_counterparty boolean,
  p_identity_visibility text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_active_caller();
  v_post public.posts;
begin
  if p_surface_visibility is null or p_surface_visibility not in ('Public', 'FollowersOnly', 'OnlyMe') then
    raise exception 'invalid_surface_visibility' using errcode = 'P0001';
  end if;
  if p_identity_visibility is not null and p_identity_visibility not in ('Public', 'FollowersOnly', 'Hidden') then
    raise exception 'invalid_identity_visibility' using errcode = 'P0001';
  end if;
  select p.* into v_post from public.posts p where p.id = p_post_id;
  if not found then
    raise exception 'post_not_found' using errcode = 'P0001';
  end if;
  if v_post.owner_id <> v_user_id and not exists (
       select 1 from public.post_handoffs h
        where h.post_id = p_post_id and h.recipient_id = v_user_id and h.status = 'handed_over') then
    raise exception 'not_participant' using errcode = 'P0001';
  end if;
  -- Only a private profile has approved followers to limit a post to (a public one is followed freely).
  if p_surface_visibility = 'FollowersOnly'
     and not exists (select 1 from public.users u where u.id = v_user_id and u.privacy_mode = 'Private') then
    raise exception 'followers_only_requires_private' using errcode = 'P0001';
  end if;

  insert into public.post_actor_identity as i
         (post_id, user_id, surface_visibility, identity_visibility, hide_from_counterparty)
  values (p_post_id, v_user_id, p_surface_visibility, p_identity_visibility,
          coalesce(p_hide_from_counterparty, false))
  on conflict (post_id, user_id) do update
    set surface_visibility = excluded.surface_visibility,
        identity_visibility = coalesce(excluded.identity_visibility, i.identity_visibility),
        hide_from_counterparty = excluded.hide_from_counterparty;

  if v_post.owner_id = v_user_id and v_post.status = 'closed_delivered'
     and v_post.visibility <> p_surface_visibility then
    update public.posts p set visibility = p_surface_visibility where p.id = p_post_id;
  end if;
end;
$$;
comment on function public.upsert_post_actor_identity(uuid, text, boolean, text) is
  'The caller sets their audience and identity mask on a post they own or received (FR-POST-021).';
