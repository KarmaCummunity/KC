-- Migration 0149: Admin Content & Users search RPCs (P3.A4).
-- Mapped to spec: docs/SSOT/spec/12_super_admin.md FR-ADMIN-019 / FR-ADMIN-020.
--
-- Three SECURITY DEFINER RPCs that give the admin portal server-paginated
-- search across users, posts, and audit_events without needing the moderated
-- rows to be visible via the regular RLS policies:
--
--   admin_search_users(query, status_filter, limit, offset)
--     Bypasses users_select_active so the admin can find banned / suspended
--     accounts (closes TD-93 at the UX level — the underlying policy gap
--     remains intentional for non-admin callers).
--
--   admin_search_posts(query, status_filter, limit, offset)
--     Joins posts with owner display_name, surfaces removed/expired/etc rows.
--
--   admin_audit_search(target_user_id, actor_id, action_filter, limit, offset)
--     Visibility tiering per PERMISSION_MATRIX['audit.view_any']:
--       super_admin -> sees everything
--       moderator   -> sees own actions OR rows where they handled the target
--       support     -> sees own actions only
--
-- All three RPCs use `admin_assert_role` for the role gate; the matrix tier
-- check inside admin_audit_search is an additional row-level filter inside
-- the SECURITY DEFINER body.

-- ── 1. admin_search_users ───────────────────────────────────────────────────
create or replace function public.admin_search_users(
  p_query  text default null,
  p_status text default null,
  p_limit  int  default 50,
  p_offset int  default 0
)
returns table (
  user_id        uuid,
  display_name   text,
  share_handle   text,
  account_status text,
  city_name      text,
  created_at     timestamptz,
  last_seen_at   timestamptz,
  total_count    bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_lim   int  := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_off   int  := greatest(coalesce(p_offset, 0), 0);
  v_q     text := nullif(trim(coalesce(p_query, '')), '');
  v_total bigint;
begin
  perform admin_assert_role(v_actor, ARRAY['super_admin','moderator','support']);

  if p_status is not null and p_status not in (
    'active','pending_verification','banned','suspended_admin','suspended_for_false_reports','deleted'
  ) then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  select count(*) into v_total
    from public.users u
   where (v_q       is null or u.display_name ilike '%' || v_q || '%' or u.share_handle ilike '%' || v_q || '%')
     and (p_status  is null or u.account_status = p_status);

  return query
  select
    u.user_id,
    u.display_name,
    u.share_handle,
    u.account_status,
    u.city_name,
    u.created_at,
    u.last_seen_at,
    v_total as total_count
  from public.users u
  where (v_q       is null or u.display_name ilike '%' || v_q || '%' or u.share_handle ilike '%' || v_q || '%')
    and (p_status  is null or u.account_status = p_status)
  order by
    case u.account_status when 'active' then 0 when 'pending_verification' then 1 else 2 end,
    u.last_seen_at desc nulls last,
    u.created_at desc
  limit v_lim offset v_off;
end;
$$;

comment on function public.admin_search_users(text, text, int, int) is
  'super_admin/moderator/support — server-paginated user search bypassing users_select_active. Closes TD-93.';

revoke execute on function public.admin_search_users(text, text, int, int) from public;
grant  execute on function public.admin_search_users(text, text, int, int) to authenticated;

-- ── 2. admin_search_posts ───────────────────────────────────────────────────
create or replace function public.admin_search_posts(
  p_query  text default null,
  p_status text default null,
  p_limit  int  default 50,
  p_offset int  default 0
)
returns table (
  post_id              uuid,
  title                text,
  type                 text,
  status               text,
  visibility           text,
  owner_id             uuid,
  owner_display_name   text,
  created_at           timestamptz,
  updated_at           timestamptz,
  total_count          bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_lim   int  := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_off   int  := greatest(coalesce(p_offset, 0), 0);
  v_q     text := nullif(trim(coalesce(p_query, '')), '');
  v_total bigint;
begin
  perform admin_assert_role(v_actor, ARRAY['super_admin','moderator','support']);

  if p_status is not null and p_status not in (
    'open','closed_delivered','deleted_no_recipient','removed_admin','expired'
  ) then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  select count(*) into v_total
    from public.posts p
   where (v_q       is null or p.title ilike '%' || v_q || '%' or p.description ilike '%' || v_q || '%')
     and (p_status  is null or p.status = p_status);

  return query
  select
    p.post_id,
    p.title,
    p.type,
    p.status,
    p.visibility,
    p.owner_id,
    u.display_name as owner_display_name,
    p.created_at,
    p.updated_at,
    v_total as total_count
  from public.posts p
  left join public.users u on u.user_id = p.owner_id
  where (v_q       is null or p.title ilike '%' || v_q || '%' or p.description ilike '%' || v_q || '%')
    and (p_status  is null or p.status = p_status)
  order by
    case p.status when 'open' then 0 when 'closed_delivered' then 1 else 2 end,
    p.updated_at desc
  limit v_lim offset v_off;
end;
$$;

comment on function public.admin_search_posts(text, text, int, int) is
  'super_admin/moderator/support — server-paginated post search across all statuses.';

revoke execute on function public.admin_search_posts(text, text, int, int) from public;
grant  execute on function public.admin_search_posts(text, text, int, int) to authenticated;

-- ── 3. admin_audit_search (RBAC-tiered) ────────────────────────────────────
create or replace function public.admin_audit_search(
  p_target_user_id uuid default null,
  p_actor_id       uuid default null,
  p_action         text default null,
  p_limit          int  default 100,
  p_offset         int  default 0
)
returns table (
  event_id     uuid,
  actor_id     uuid,
  actor_display_name text,
  action       text,
  target_type  text,
  target_id    uuid,
  target_display_name text,
  metadata     jsonb,
  created_at   timestamptz,
  total_count  bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_lim   int  := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_off   int  := greatest(coalesce(p_offset, 0), 0);
  v_is_super boolean;
  v_is_mod   boolean;
  v_total bigint;
begin
  perform admin_assert_role(v_actor, ARRAY['super_admin','moderator','support']);
  v_is_super := public.has_admin_role(v_actor, 'super_admin');
  v_is_mod   := public.has_admin_role(v_actor, 'moderator');

  -- Build the same WHERE twice (count + page) to keep the planner simple.
  select count(*) into v_total
    from public.audit_events e
   where (p_target_user_id is null or e.target_id = p_target_user_id)
     and (p_actor_id       is null or e.actor_id  = p_actor_id)
     and (p_action         is null or e.action    = p_action)
     and (
       v_is_super
       or (v_is_mod and (e.actor_id = v_actor or e.target_id = v_actor))
       or (not v_is_super and not v_is_mod and e.actor_id = v_actor)
     );

  return query
  select
    e.event_id,
    e.actor_id,
    ua.display_name as actor_display_name,
    e.action,
    e.target_type,
    e.target_id,
    ut.display_name as target_display_name,
    e.metadata,
    e.created_at,
    v_total as total_count
  from public.audit_events e
  left join public.users ua on ua.user_id = e.actor_id
  left join public.users ut on ut.user_id = e.target_id
  where (p_target_user_id is null or e.target_id = p_target_user_id)
    and (p_actor_id       is null or e.actor_id  = p_actor_id)
    and (p_action         is null or e.action    = p_action)
    and (
      v_is_super
      or (v_is_mod and (e.actor_id = v_actor or e.target_id = v_actor))
      or (not v_is_super and not v_is_mod and e.actor_id = v_actor)
    )
  order by e.created_at desc
  limit v_lim offset v_off;
end;
$$;

comment on function public.admin_audit_search(uuid, uuid, text, int, int) is
  'RBAC-tiered audit_events search. super_admin sees all; moderator sees own+handled-target; support sees own only.';

revoke execute on function public.admin_audit_search(uuid, uuid, text, int, int) from public;
grant  execute on function public.admin_audit_search(uuid, uuid, text, int, int) to authenticated;
