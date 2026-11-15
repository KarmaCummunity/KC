-- 0085_post_actor_identity_audience_split.sql
-- D-28: per-participant `surface_visibility` for closed-post audience.
-- Supersedes D-19's third-party closed visibility clause; refines D-26.
-- FR-POST-021 rewrite — three-axis model:
--   surface_visibility  (audience: who discovers the post through this participant's surface)
--   identity_visibility (identity chrome: how name/avatar/deeplink render on post surfaces; renamed from `exposure`)
--   hide_from_counterparty (counterparty-only identity mask; unchanged)

set search_path = public;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Schema: add `surface_visibility`; rename `exposure` → `identity_visibility`.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.post_actor_identity
  add column if not exists surface_visibility text not null default 'Public';

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on c.conrelid = t.oid
    where t.relname = 'post_actor_identity'
      and c.conname = 'post_actor_identity_surface_visibility_check'
  ) then
    alter table public.post_actor_identity
      add constraint post_actor_identity_surface_visibility_check
      check (surface_visibility in ('Public', 'FollowersOnly', 'OnlyMe'));
  end if;
end$$;

-- Rename `exposure` → `identity_visibility` if the old column still exists.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'post_actor_identity'
      and column_name  = 'exposure'
  ) then
    alter table public.post_actor_identity rename column exposure to identity_visibility;
  end if;
end$$;

-- Drop the auto-named check constraint that references the old `exposure` column
-- and reinstate one bound to `identity_visibility`. Idempotent on re-runs.
do $$
declare
  v_old_name text;
begin
  select c.conname
    into v_old_name
  from pg_constraint c
  join pg_class t on c.conrelid = t.oid
  where t.relname = 'post_actor_identity'
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%exposure%';
  if v_old_name is not null then
    execute format('alter table public.post_actor_identity drop constraint %I', v_old_name);
  end if;
end$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on c.conrelid = t.oid
    where t.relname = 'post_actor_identity'
      and c.conname = 'post_actor_identity_identity_visibility_check'
  ) then
    alter table public.post_actor_identity
      add constraint post_actor_identity_identity_visibility_check
      check (identity_visibility in ('Public', 'FollowersOnly', 'Hidden'));
  end if;
end$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. SECURITY DEFINER helper: participant_closed_surface_visible
--    Resolves whether a viewer is admitted by a participant's surface gate.
--    Fallback when no `post_actor_identity` row exists:
--      • actor = post.owner_id → posts.visibility (preserves owner intent for
--        legacy posts and for new posts where the owner never opted in).
--      • actor ≠ post.owner_id → 'Public' (D-28 default for non-publishers; the
--        respondent's own surface).
--    Owner and active recipients always retain read access; this helper is
--    only consulted for third-party access decisions.
--    SECURITY DEFINER + direct table read bypasses RLS so calls from
--    is_post_visible_to and from the post_actor_identity SELECT policy do not
--    recurse back through that policy.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.participant_closed_surface_visible(
  p_post   public.posts,
  p_actor  uuid,
  p_viewer uuid
) returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_sv text;
begin
  if p_actor is null then
    return false;
  end if;

  select pai.surface_visibility
    into v_sv
  from public.post_actor_identity pai
  where pai.post_id = p_post.post_id
    and pai.user_id = p_actor
  limit 1;

  if v_sv is null then
    if p_actor = p_post.owner_id then
      v_sv := p_post.visibility::text;
    else
      v_sv := 'Public';
    end if;
  end if;

  return case v_sv
    when 'Public'        then true
    when 'OnlyMe'        then false
    when 'FollowersOnly' then coalesce(public.is_following(p_viewer, p_actor), false)
    else true
  end;
end;
$$;

revoke execute on function public.participant_closed_surface_visible(public.posts, uuid, uuid) from public;
grant  execute on function public.participant_closed_surface_visible(public.posts, uuid, uuid) to authenticated, anon, service_role;

comment on function public.participant_closed_surface_visible(public.posts, uuid, uuid) is
  'D-28 / FR-POST-021 AC3: resolves a participant''s surface_visibility for a viewer. Falls back to posts.visibility for the publisher (preserves owner intent) and to Public for non-publishers. SECURITY DEFINER to break RLS recursion through is_post_visible_to.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Refresh is_post_visible_to.
--    closed_delivered third-party gate = OR across participants' surfaces.
--    Owner and recipient always read (counterparty-read invariant).
--    Open / tomb branches unchanged from 0059.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.is_post_visible_to(p_post public.posts, p_viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    -- Owner always sees their own row.
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
    -- closed_delivered: recipient always sees; third parties pass iff EITHER
    -- participant's surface_visibility admits them (D-28).
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
    -- open: standard visibility ladder.
    when p_post.status = 'open' and p_post.visibility = 'Public' then true
    when p_post.status = 'open' and p_post.visibility = 'OnlyMe' then false
    when p_post.status = 'open' and p_post.visibility = 'FollowersOnly' then
      public.is_following(p_viewer, p_post.owner_id)
    else false
  end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Refresh profile_closed_posts: role-aware surface gate per row.
--    Publisher rows → gated by owner's surface; respondent rows → gated by
--    respondent's surface. Owner and any active recipient of the post always
--    see their own & related rows. deleted_no_recipient stays owner-only.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.profile_closed_posts(
  p_profile_user_id uuid,
  p_viewer_user_id  uuid,
  p_limit           int          default 30,
  p_cursor          timestamptz  default null
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
  -- Service role bypasses the viewer-id check (no auth.uid() context).
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
    -- Publisher side: profile user is the owner.
    -- Includes BOTH closed_delivered AND deleted_no_recipient (7-day reopen
    -- grace window — FR-CLOSURE-005 AC4, FR-CLOSURE-008).
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
      -- Defensive: publisher cannot also be respondent (FR-CLOSURE-003).
      and p.owner_id <> p_profile_user_id
  )
  select u.post_id, u.identity_role, u.closed_at
  from unioned u
  join public.posts p on p.post_id = u.post_id
  left join public.recipients r2 on r2.post_id = p.post_id
  where
    -- Universal negatives mirror is_post_visible_to (blocks, reporter hides).
    not public.is_blocked(p_viewer_user_id, p.owner_id)
    and not exists (
      select 1 from public.reporter_hides h
      where h.reporter_id = p_viewer_user_id
        and h.target_type = 'post'
        and h.target_id   = p.post_id
    )
    -- Role-aware status gate (D-28).
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

grant execute on function public.profile_closed_posts(uuid, uuid, int, timestamptz) to authenticated, anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RLS recursion safety analysis (no policy changes required).
--    The existing `post_actor_identity_select_post_visible` SELECT policy
--    (migration 0083) calls is_post_visible_to(p, auth.uid()). After this
--    migration, is_post_visible_to internally calls participant_closed_surface_visible
--    which reads post_actor_identity. Both functions are SECURITY DEFINER, so
--    the inner reads run with the function-owner's privileges and bypass RLS —
--    breaking the recursion chain. No policy edit needed.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Column comments (live documentation for ad-hoc DB browsing).
-- ─────────────────────────────────────────────────────────────────────────────

comment on column public.post_actor_identity.surface_visibility is
  'D-28 / FR-POST-021 AC1: per-participant audience for closed-post discovery through this participant''s surface. Public (default) / FollowersOnly (viewer must follow actor) / OnlyMe (third parties never reach via this surface). Owner and active recipient always retain read access regardless.';

comment on column public.post_actor_identity.identity_visibility is
  'D-26 / FR-POST-021 AC1: per-participant identity chrome (renamed from `exposure`). Public (full name/avatar/deeplink to viewers permitted to read the post) / FollowersOnly (anonymous to non-followers) / Hidden (anonymous to all non-self).';

comment on column public.post_actor_identity.hide_from_counterparty is
  'D-26 / FR-POST-021 AC4(a): force anonymous identity to the counterparty on post chrome, regardless of identity_visibility.';
