-- Migration 0138: Admin RBAC management RPCs (P3.A2).
-- Mapped to spec: docs/SSOT/spec/12_super_admin.md FR-ADMIN-015 / FR-ADMIN-016 / FR-ADMIN-017.
--
-- Ships three RPCs:
--   * admin_grant_role(target_user_id, role)        — super_admin only; grants moderator|support.
--   * admin_revoke_role(grant_id)                   — super_admin only; blocks last-super_admin demotion.
--   * admin_list_admins(include_revoked)            — super_admin|moderator; rows joined with user display.
--
-- Audit:
--   Widens audit_events.action allow-list with 'admin_role_grant' and 'admin_role_revoke'
--   (dance pattern v3 -> v4, mirroring 0034 / 0075).
--
-- Security:
--   - admin_assert_role gates each write at the RPC body (caller re-checked server-side).
--   - The single-active-super_admin invariant is preserved both at the unique-index level
--     (migration 0112) and by an explicit guard in admin_revoke_role that refuses the last
--     active super_admin row.
--   - Grant attempts on a user that already holds the requested active role surface as
--     'role_already_active' (unique_violation mapped) rather than a 500.
--   - Grant attempts targeting 'super_admin' or PRD-V2-reserved roles are rejected;
--     escalation to super_admin remains a manual DB operation per CLAUDE.md §7.

-- ── 1. Widen audit_events.action allow-list ─────────────────────────────────
alter table public.audit_events
  drop constraint if exists audit_events_action_check;

alter table public.audit_events
  add constraint audit_events_action_check_v4 check (action in (
    'block_user','unblock_user',
    'report_target',
    'auto_remove_target','manual_remove_target','restore_target',
    'suspend_user','unsuspend_user',
    'ban_user',
    'false_report_sanction_applied',
    'dismiss_report','confirm_report',
    'delete_message',
    'delete_account',
    'unmark_recipient_self',
    'admin_role_grant','admin_role_revoke'
  )) not valid;

alter table public.audit_events validate constraint audit_events_action_check_v4;
alter table public.audit_events
  rename constraint audit_events_action_check_v4 to audit_events_action_check;

-- ── 2. admin_grant_role ─────────────────────────────────────────────────────
drop function if exists public.admin_grant_role(uuid, text);

create function public.admin_grant_role(
  p_target_user_id uuid,
  p_role           text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor    uuid := auth.uid();
  v_grant_id uuid;
  v_target_status text;
begin
  perform admin_assert_role(v_actor, ARRAY['super_admin']);

  if p_target_user_id is null then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if p_role is null or p_role not in ('moderator', 'support') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;

  select account_status
    into v_target_status
    from public.users
    where user_id = p_target_user_id;

  if v_target_status is null then
    raise exception 'target_not_found' using errcode = 'P0002';
  end if;
  if v_target_status <> 'active' then
    raise exception 'target_not_active' using errcode = '23514';
  end if;

  begin
    insert into public.admin_role_grants (user_id, role, granted_by)
    values (p_target_user_id, p_role, v_actor)
    returning grant_id into v_grant_id;
  exception
    when unique_violation then
      raise exception 'role_already_active' using errcode = '23505';
  end;

  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (
    v_actor,
    'admin_role_grant',
    'user',
    p_target_user_id,
    jsonb_build_object('role', p_role, 'grant_id', v_grant_id)
  );

  return v_grant_id;
end;
$$;

comment on function public.admin_grant_role(uuid, text) is
  'super_admin-only RPC to grant moderator|support to an active user. Returns grant_id; emits audit_event.';

revoke execute on function public.admin_grant_role(uuid, text) from public;
grant  execute on function public.admin_grant_role(uuid, text) to authenticated;

-- ── 3. admin_revoke_role ────────────────────────────────────────────────────
drop function if exists public.admin_revoke_role(uuid);

create function public.admin_revoke_role(
  p_grant_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor       uuid := auth.uid();
  v_user_id     uuid;
  v_role        text;
  v_revoked_at  timestamptz;
  v_super_count int;
begin
  perform admin_assert_role(v_actor, ARRAY['super_admin']);

  if p_grant_id is null then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  select user_id, role, revoked_at
    into v_user_id, v_role, v_revoked_at
    from public.admin_role_grants
    where grant_id = p_grant_id
    for update;

  if v_user_id is null then
    raise exception 'grant_not_found' using errcode = 'P0002';
  end if;
  if v_revoked_at is not null then
    raise exception 'grant_already_revoked' using errcode = '23514';
  end if;

  if v_role = 'super_admin' then
    select count(*)
      into v_super_count
      from public.admin_role_grants
      where role = 'super_admin' and revoked_at is null;
    if v_super_count <= 1 then
      raise exception 'cannot_revoke_last_super_admin' using errcode = 'P0001';
    end if;
  end if;

  update public.admin_role_grants
     set revoked_at = now(),
         revoked_by = v_actor
   where grant_id = p_grant_id;

  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (
    v_actor,
    'admin_role_revoke',
    'user',
    v_user_id,
    jsonb_build_object('role', v_role, 'grant_id', p_grant_id)
  );
end;
$$;

comment on function public.admin_revoke_role(uuid) is
  'super_admin-only RPC to revoke an active grant. Refuses to demote the last super_admin. Emits audit_event.';

revoke execute on function public.admin_revoke_role(uuid) from public;
grant  execute on function public.admin_revoke_role(uuid) to authenticated;

-- ── 4. admin_list_admins ────────────────────────────────────────────────────
drop function if exists public.admin_list_admins(boolean);

create function public.admin_list_admins(
  p_include_revoked boolean default false
)
returns table (
  grant_id                uuid,
  user_id                 uuid,
  display_name            text,
  avatar_url              text,
  role                    text,
  granted_at              timestamptz,
  granted_by              uuid,
  granted_by_display_name text,
  revoked_at              timestamptz,
  revoked_by              uuid,
  last_seen_at            timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  perform admin_assert_role(v_actor, ARRAY['super_admin', 'moderator']);

  return query
  select
    g.grant_id,
    g.user_id,
    u.display_name,
    u.avatar_url,
    g.role,
    g.granted_at,
    g.granted_by,
    gby.display_name as granted_by_display_name,
    g.revoked_at,
    g.revoked_by,
    u.last_seen_at
  from public.admin_role_grants g
  join public.users u  on u.user_id = g.user_id
  left join public.users gby on gby.user_id = g.granted_by
  where (p_include_revoked or g.revoked_at is null)
  order by
    case g.role
      when 'super_admin' then 0
      when 'moderator'   then 1
      when 'support'     then 2
      else 9
    end,
    g.granted_at desc;
end;
$$;

comment on function public.admin_list_admins(boolean) is
  'super_admin|moderator visibility: returns admin grants joined with display_name+last_seen_at.';

revoke execute on function public.admin_list_admins(boolean) from public;
grant  execute on function public.admin_list_admins(boolean) to authenticated;
