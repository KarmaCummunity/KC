-- 0107_profile_closed_posts_surface_visibility.sql
-- D-39 (dual-surface closed-post privacy) — Hidden/standard routing reads
-- effective owner surface_visibility, not posts.visibility.
--
-- Why: D-34 fanned out `posts.visibility = OnlyMe` alongside
-- `post_actor_identity.surface_visibility = OnlyMe` only because the RPC
-- gated Hidden/Closed-tab routing by `posts.visibility`. After D-39 the
-- per-participant surface is the sole source of truth for closed-post audience
-- on each participant's profile surface; the mobile fan-out is removed.
--
-- Backwards-compat: for legacy rows with `posts.visibility = OnlyMe` but no
-- `post_actor_identity` row, the coalesce fallback to `posts.visibility::text`
-- preserves their Hidden-tab placement and third-party exclusion without a
-- data backfill.
--
-- Mapped to: FR-PROFILE-001 AC4, FR-POST-009 AC5, FR-POST-021 AC4.

set search_path = public;

drop function if exists public.profile_closed_posts(uuid, uuid, int, timestamptz, text);

create or replace function public.profile_closed_posts(
  p_profile_user_id uuid,
  p_viewer_user_id  uuid,
  p_limit           int          default 30,
  p_cursor          timestamptz  default null,
  p_list_mode       text         default 'standard'
)
returns table (
  post_id        uuid,
  identity_role  text,
  closed_at      timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_list_mode not in ('standard', 'owner_only_me') then
    raise exception 'invalid_list_mode' using errcode = '22023';
  end if;

  if p_list_mode = 'owner_only_me'
     and p_viewer_user_id is distinct from p_profile_user_id
  then
    return;
  end if;

  if current_setting('request.jwt.claim.role', true) is distinct from 'service_role'
     and p_viewer_user_id is not null
     and p_viewer_user_id is distinct from auth.uid()
  then
    raise exception 'forbidden_viewer_mismatch' using errcode = '42501';
  end if;

  return query
  with safe_limit as (
    select greatest(1, least(coalesce(p_limit, 30), 100))::int as n
  ),
  unioned as (
    -- Publisher side: profile user is the owner. Includes BOTH
    -- closed_delivered AND deleted_no_recipient (7-day reopen grace —
    -- FR-CLOSURE-005 AC4, FR-CLOSURE-008).
    select
      p.post_id,
      'publisher'::text                    as identity_role,
      p.owner_id                           as role_actor_id,
      coalesce(r.marked_at, p.updated_at)  as closed_at
    from public.posts p
    left join public.recipients r on r.post_id = p.post_id
    where p.owner_id = p_profile_user_id
      and p.status in ('closed_delivered', 'deleted_no_recipient')

    union all

    -- Respondent side: profile user is the recipient. Only closed_delivered.
    select
      p.post_id,
      'respondent'::text   as identity_role,
      r.recipient_user_id  as role_actor_id,
      r.marked_at          as closed_at
    from public.posts p
    join public.recipients r on r.post_id = p.post_id
    where r.recipient_user_id = p_profile_user_id
      and p.status = 'closed_delivered'
      and p.owner_id <> p_profile_user_id
  )
  select u.post_id, u.identity_role, u.closed_at
  from unioned u
  join public.posts p on p.post_id = u.post_id
  left join public.recipients r2 on r2.post_id = p.post_id
  -- Effective surface for the row's role-actor: prefer the user's
  -- post_actor_identity.surface_visibility; fall back to posts.visibility for
  -- the publisher (preserves legacy owner intent) and to 'Public' for the
  -- respondent (their default surface).
  left join lateral (
    select coalesce(
      (select pai.surface_visibility
         from public.post_actor_identity pai
        where pai.post_id = u.post_id
          and pai.user_id = u.role_actor_id
        limit 1),
      case
        when u.role_actor_id = p.owner_id then p.visibility::text
        else 'Public'
      end
    ) as effective_surface
  ) es on true
  where
    not public.is_blocked(p_viewer_user_id, p.owner_id)
    and not exists (
      select 1 from public.reporter_hides h
      where h.reporter_id = p_viewer_user_id
        and h.target_type = 'post'
        and h.target_id   = p.post_id
    )
    -- D-39 routing: Hidden tab = effective surface OnlyMe; Standard tab on
    -- own profile excludes effective surface OnlyMe. Third-party rows are
    -- gated below via participant_closed_surface_visible (unchanged).
    and (
      case
        when p_list_mode = 'owner_only_me' then
          es.effective_surface = 'OnlyMe'
        else
          not (
            p_viewer_user_id is not distinct from p_profile_user_id
            and es.effective_surface = 'OnlyMe'
          )
      end
    )
    and (
      case
        when p.status = 'deleted_no_recipient' then
          p.owner_id = p_viewer_user_id
        when p.status = 'closed_delivered' then
          p.owner_id            = p_viewer_user_id
          or r2.recipient_user_id = p_viewer_user_id
          or public.participant_closed_surface_visible(p, u.role_actor_id, p_viewer_user_id)
        else false
      end
    )
    and (p_cursor is null or u.closed_at < p_cursor)
  order by u.closed_at desc
  limit (select n from safe_limit);
end;
$$;

grant execute on function public.profile_closed_posts(uuid, uuid, int, timestamptz, text)
  to authenticated, anon;

comment on function public.profile_closed_posts(uuid, uuid, int, timestamptz, text) is
  'D-28/D-39/FR-POST-021: per-profile closed posts (publisher + respondent rows). Hidden tab and Standard own-profile exclusion key on effective surface_visibility (post_actor_identity row, falling back to posts.visibility for the publisher, ''Public'' for the respondent). Third-party rows gated by participant_closed_surface_visible.';
