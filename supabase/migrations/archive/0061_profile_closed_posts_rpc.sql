-- 0061_profile_closed_posts_rpc.sql (renumbered from 0057 → 0060 → 0061 — see 0059/0060 notes)
-- Spec: docs/superpowers/specs/2026-05-13-closed-posts-on-both-profiles-design.md
-- Returns the set of closed_delivered posts to display on a user's "Closed Posts"
-- tab — the UNION of posts they published AND posts on which they are the
-- respondent (`recipients.recipient_user_id`). Each row carries the identity
-- role of `profile_user_id` on the post: 'publisher' or 'respondent'.
--
-- Visibility filtering reuses `public.is_post_visible_to(post, viewer_user_id)`,
-- so the caller only sees rows their auth context is allowed to read. The
-- function is SECURITY INVOKER (default) — RLS on posts/recipients applies in
-- addition to the predicate.
--
-- Pagination: `p_cursor` (timestamptz) is exclusive — pass the last `closed_at`
-- of the previous page. `p_limit` is clamped to [1, 100].
--
-- SECURITY: SECURITY DEFINER is required because `recipients` RLS blocks
-- third-party reads, so the function must bypass it to discover the
-- "received" side of the UNION. To prevent privilege escalation the function
-- asserts that `p_viewer_user_id` is either NULL, equal to auth.uid(), or
-- the caller is the service_role (cron / edge functions / admin).
--
-- NOTE: this RPC intentionally does NOT guard on the profile user's
-- privacy_mode. Per product, every user's profile is publicly visible (header
-- + identity); only individual posts are filtered by their per-post
-- `visibility`. FR-PROFILE-003's locked-panel behavior is a FE-level concern
-- and is enforced in the mobile screens before this RPC is even called.

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
  -- For authenticated/anon callers: `is distinct from` handles NULL correctly,
  -- so an anon caller (auth.uid()=NULL) passing a concrete viewer id is
  -- rejected. Equality (`<>`) would silently pass that case.
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
    -- Publisher side: posts the profile user authored.
    -- Includes BOTH closed_delivered AND deleted_no_recipient so the publisher
    -- can still reopen / observe posts they closed without a recipient (within
    -- the 7-day grace window — FR-CLOSURE-005 AC4, FR-CLOSURE-008).
    select
      p.post_id,
      'publisher'::text as identity_role,
      coalesce(r.marked_at, p.updated_at) as closed_at
    from public.posts p
    left join public.recipients r on r.post_id = p.post_id
    where p.owner_id = p_profile_user_id
      and p.status in ('closed_delivered', 'deleted_no_recipient')

    union all

    -- Respondent side: posts where the profile user was picked at closure.
    -- Only closed_delivered — deleted_no_recipient has no respondent row.
    select
      p.post_id,
      'respondent'::text as identity_role,
      r.marked_at as closed_at
    from public.posts p
    join public.recipients r on r.post_id = p.post_id
    where r.recipient_user_id = p_profile_user_id
      and p.status = 'closed_delivered'
      -- Defensive: publisher cannot also be respondent (enforced by FR-CLOSURE-003).
      and p.owner_id <> p_profile_user_id
  )
  select u.post_id, u.identity_role, u.closed_at
  from unioned u
  join public.posts p on p.post_id = u.post_id
  where public.is_post_visible_to(p.*, p_viewer_user_id)
    and (p_cursor is null or u.closed_at < p_cursor)
  order by u.closed_at desc
  limit (select n from safe_limit);
end;
$$;

grant execute on function public.profile_closed_posts(uuid, uuid, int, timestamptz) to authenticated, anon;
