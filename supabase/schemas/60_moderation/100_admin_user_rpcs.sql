-- Moderation · staff actions on a member (FR-ADMIN-003 AC3, FR-ADMIN-004, D133, D135)
--
--   suspend   moderator and above; optionally until a date, after which the sweep lifts it
--   ban       super admin only; permanent
--   restore   a suspension by a moderator; a ban by the super admin only (D133)
-- A staff member cannot be sanctioned (revoke the role first) and nobody sanctions
-- themselves. An account under deletion is not sanctioned: the member is leaving, and a
-- sanction would cancel the deletion they asked for (FR-ADMIN-004 AC3).
-- Errors: forbidden (42501); P0001 — target_not_found, cannot_sanction_self,
-- cannot_sanction_admin, invalid_sanction_reason, account_pending_deletion,
-- invalid_target_state, invalid_restore_state.

-- Checks shared by suspend and ban; returns the member's locked account row.
create function kc_private.sanction_target(p_actor uuid, p_user_id uuid, p_reason text)
returns public.user_account
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account public.user_account;
begin
  if p_user_id = p_actor then
    raise exception 'cannot_sanction_self' using errcode = 'P0001';
  end if;
  if p_reason is null or p_reason not in ('spam', 'harassment', 'policy_violation', 'other') then
    raise exception 'invalid_sanction_reason' using errcode = 'P0001';
  end if;
  select a.* into v_account from public.user_account a where a.user_id = p_user_id for update;
  if not found then
    raise exception 'target_not_found' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.admin_role_grants g
              where g.user_id = p_user_id and g.revoked_at is null and g.is_platform) then
    raise exception 'cannot_sanction_admin' using errcode = 'P0001';
  end if;
  if v_account.status = 'pending_deletion' then
    raise exception 'account_pending_deletion' using errcode = 'P0001';
  end if;
  return v_account;
end;
$$;

create function public.admin_suspend_user(
  p_user_id uuid, p_reason text, p_until timestamptz default null, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.require_admin_role('moderator');
  v_account constant public.user_account := kc_private.sanction_target(v_actor, p_user_id, p_reason);
begin
  if v_account.status in ('suspended_admin', 'banned') or p_until <= now() then
    raise exception 'invalid_target_state' using errcode = 'P0001';
  end if;
  perform kc_private.account_sanction(p_user_id, 'suspended_admin', p_reason, p_until, p_note, v_actor);
end;
$$;
comment on function public.admin_suspend_user(uuid, text, timestamptz, text) is
  'Staff: suspends a member, open-ended or until a date.';
grant execute on function public.admin_suspend_user(uuid, text, timestamptz, text) to authenticated;

-- Idempotent on a member who is already banned (no second audit row).
create function public.admin_ban_user(p_user_id uuid, p_reason text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.require_admin_role('super_admin');
  v_account constant public.user_account := kc_private.sanction_target(v_actor, p_user_id, p_reason);
begin
  if v_account.status = 'banned' then
    return;
  end if;
  perform kc_private.account_sanction(p_user_id, 'banned', p_reason, null, p_note, v_actor);
end;
$$;
comment on function public.admin_ban_user(uuid, text, text) is 'Super admin: bans a member permanently.';
grant execute on function public.admin_ban_user(uuid, text, text) to authenticated;

-- Idempotent on an active member.
create function public.admin_restore_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.require_admin_role('moderator');
  v_status text;
begin
  select a.status into v_status from public.user_account a where a.user_id = p_user_id for update;
  if not found then
    raise exception 'target_not_found' using errcode = 'P0001';
  end if;
  if v_status = 'active' then
    return;
  end if;
  if v_status not in ('suspended_admin', 'suspended_for_false_reports', 'banned') then
    raise exception 'invalid_restore_state' using errcode = 'P0001';
  end if;
  if v_status = 'banned' then
    perform kc_private.require_admin_role('super_admin');
  end if;
  perform kc_private.account_restore(p_user_id, v_actor, 'admin_restore');
  perform kc_private.moderation_queue_close('user', p_user_id, v_actor);
end;
$$;
comment on function public.admin_restore_user(uuid) is
  'Staff: lifts a suspension; only the super admin lifts a ban.';
grant execute on function public.admin_restore_user(uuid) to authenticated;
