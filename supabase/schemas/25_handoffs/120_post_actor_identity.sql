-- Handoffs · post_actor_identity (FR-POST-021, D28, D31, D39)
--
-- What each participant of a post decides about how they appear on it:
--   surface_visibility      who, beyond the two participants, may find a closed post through
--                           this participant (Public / FollowersOnly / OnlyMe)
--   identity_visibility     how the participant's name and avatar render on post chrome
--                           (Public / FollowersOnly / Hidden); null follows the world default
--   hide_from_counterparty  third parties see an anonymous poster on the post (D31)
-- The participants are the post owner and the member of a handed-over handoff. The row is
-- written only by `upsert_post_actor_identity`; masking is applied server side by
-- `kc_access.post_actor_masked`, which `post_cards` and `post_comments_page` call, so a
-- masked identity never reaches a device (the spec's client-side projection is replaced).

create table public.post_actor_identity (
  post_id                uuid not null references public.posts (id) on delete cascade,
  user_id                uuid not null references public.users (id) on delete cascade,
  surface_visibility     text not null default 'Public'
                           check (surface_visibility in ('Public', 'FollowersOnly', 'OnlyMe')),
  -- Null = the default of the post's world (`worlds.default_anonymity_level`). An explicit
  -- value can only make the identity more private than that default, never less.
  identity_visibility    text check (identity_visibility in ('Public', 'FollowersOnly', 'Hidden')),
  hide_from_counterparty boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  primary key (post_id, user_id)
);
comment on table public.post_actor_identity is
  'Per-participant audience and identity mask of a post (FR-POST-021). Written only by upsert_post_actor_identity.';

-- Query: all rows of one participant, and the user foreign key (account removal).
create index post_actor_identity_user_idx on public.post_actor_identity (user_id);

create trigger post_actor_identity_set_updated_at
  before update on public.post_actor_identity
  for each row execute function kc_private.set_updated_at();

alter table public.post_actor_identity enable row level security;
alter table public.post_actor_identity force row level security;

-- A participant reads their own row. Unlike the former design, nobody reads the other
-- participant's row: the mask is applied by the server, so no device needs it.
create policy post_actor_identity_select_own on public.post_actor_identity
  for select to authenticated
  using (user_id = (select auth.uid()));

grant select on public.post_actor_identity to authenticated;

-- True when the caller must not be shown who `p_actor_id` is on post `p_post_id`. Only the
-- two participants of a post can be masked; the viewer is never masked from themselves, the
-- counterparty always sees the real identity (AC2, AC4, D39) and platform staff see through
-- the mask. For a third party the actor is masked when
--   * the effective identity level is "operators only" (world default 1 or `Hidden`), or
--     "followers" (level 2 or `FollowersOnly`) and the viewer does not follow the actor; or
--   * the post is delivered and the actor chose `hide_from_counterparty`, or an `OnlyMe`
--     surface (which implies the mask, AC4).
-- Definer rights read the rows the caller cannot see; the answer is a boolean only.
-- The staff test calls `kc_access.is_admin()` of the moderation module, resolved when the
-- function runs (plpgsql), because that module is created later.
create function kc_access.post_actor_masked(p_post_id uuid, p_actor_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_viewer constant uuid := (select auth.uid());
  v_owner uuid;
  v_status text;
  v_world_level smallint;
  v_identity public.post_actor_identity;
  v_level integer;
begin
  if p_actor_id is null or p_actor_id = v_viewer then
    return false;
  end if;
  select p.owner_id, p.status, w.default_anonymity_level into v_owner, v_status, v_world_level
    from public.posts p join public.worlds w on w.slug = p.world_slug
   where p.id = p_post_id;
  if not found then
    return false;
  end if;
  -- Not a participant (an ordinary commenter): nothing to mask.
  if p_actor_id <> v_owner and not exists (
       select 1 from public.post_handoffs h
        where h.post_id = p_post_id and h.recipient_id = p_actor_id and h.status = 'handed_over') then
    return false;
  end if;
  -- The counterparty: the owner sees the receiver, the receiver (confirmed or handed over) the owner.
  if v_viewer is not null and (
       (p_actor_id <> v_owner and v_viewer = v_owner)
       or (p_actor_id = v_owner and exists (
             select 1 from public.post_handoffs h
              where h.post_id = p_post_id and h.recipient_id = v_viewer
                and h.status in ('confirmed', 'handed_over')))) then
    return false;
  end if;
  if v_viewer is not null and kc_access.is_admin() then
    return false;
  end if;

  select i.* into v_identity from public.post_actor_identity i
   where i.post_id = p_post_id and i.user_id = p_actor_id;
  v_level := least(
    case v_identity.identity_visibility when 'FollowersOnly' then 2 when 'Hidden' then 1 else 3 end,
    v_world_level);
  if v_level = 1 then
    return true;
  end if;
  if v_level = 2 and not exists (select 1 from public.follows f
                                  where f.follower_id = v_viewer and f.followed_id = p_actor_id) then
    return true;
  end if;
  return v_status = 'closed_delivered'
    and (coalesce(v_identity.hide_from_counterparty, false)
         or coalesce(v_identity.surface_visibility = 'OnlyMe', false));
end;
$$;
comment on function kc_access.post_actor_masked(uuid, uuid) is
  'Whether the caller is shown an anonymous poster instead of this participant of the post (FR-POST-021).';
grant execute on function kc_access.post_actor_masked(uuid, uuid) to authenticated;

-- Sets the caller's audience and identity mask on a post they take part in.
--   unauthenticated                       no session (42501)
--   invalid_surface_visibility            not Public / FollowersOnly / OnlyMe
--   invalid_identity_visibility           not Public / FollowersOnly / Hidden
--   post_not_found                        no such post
--   not_participant                       the caller is neither the owner nor the receiver
--   followers_only_requires_public_profile  FollowersOnly needs a public profile (FR-POST-009)
-- The owner of a delivered post routes third-party discovery through `posts.visibility`
-- (feed, profile tabs and the read policy decide on it), so the audience is mirrored there;
-- the receiver's audience is stored for the profile surface that lists received posts.
-- `p_identity_visibility` null keeps the stored value (world default on first write).
create function public.upsert_post_actor_identity(
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
  if p_surface_visibility = 'FollowersOnly'
     and not exists (select 1 from public.users u where u.id = v_user_id and u.privacy_mode = 'Public') then
    raise exception 'followers_only_requires_public_profile' using errcode = 'P0001';
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
grant execute on function public.upsert_post_actor_identity(uuid, text, boolean, text) to authenticated;
