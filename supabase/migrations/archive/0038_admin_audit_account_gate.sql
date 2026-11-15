-- 0038_admin_audit_account_gate | P2.2 / FR-ADMIN-007 + FR-MOD-010 sign-in gate
-- admin_audit_lookup_guarded — admin-only paginated read of audit_events for
--                              a user (as actor or target). The unguarded
--                              admin_audit_lookup is internal helper, no grant.
-- auth_check_account_gate    — caller (self or admin) checks an account's
--                              moderation state. Lazy-unsuspends ONLY for the
--                              narrow `suspended_for_false_reports` AND
--                              `account_status_until <= now()` case; writes
--                              an audit row when that lazy lift fires.

-- ── 1. admin_audit_lookup (internal) ────────────────────────────────────────
-- SQL function returning setof. Pure read. Caller responsible for gating.
-- NOTE: `select *` resolves columns at function-creation time; if
-- audit_events columns are added/reordered later, drop+recreate this
-- function (and the wrapper) to refresh the column binding.
create or replace function public.admin_audit_lookup(
  p_user_id uuid,
  p_limit   int default 200
) returns setof public.audit_events
language sql
security definer
set search_path = public
as $$
  select *
    from public.audit_events
   where actor_id = p_user_id or target_id = p_user_id
   order by created_at desc
   limit least(coalesce(p_limit, 200), 1000);
$$;

-- ── 2. admin_audit_lookup_guarded (public-facing wrapper) ───────────────────
-- plpgsql wrapper that raises before yielding any rows when caller is not admin.

create or replace function public.admin_audit_lookup_guarded(
  p_user_id uuid,
  p_limit   int default 200
) returns setof public.audit_events
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_admin(auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query select * from public.admin_audit_lookup(p_user_id, p_limit);
end;
$$;

revoke execute on function public.admin_audit_lookup(uuid, int) from public;
revoke execute on function public.admin_audit_lookup_guarded(uuid, int) from public;
grant  execute on function public.admin_audit_lookup_guarded(uuid, int) to authenticated;
-- The unguarded one is internal — no grant.


-- ── 3. auth_check_account_gate ──────────────────────────────────────────────
-- Returns { allowed, reason, until_at }.
-- Caller may be the target user themselves OR an admin checking someone else.
-- Lazy unsuspend only fires for the narrow timed-false-reports case; never
-- for banned, suspended_admin, deleted, or pending_verification.

create or replace function public.auth_check_account_gate(p_user_id uuid)
returns table (
  allowed boolean,
  reason  text,
  until_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_status text;
  v_until  timestamptz;
begin
  if v_caller is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_caller <> p_user_id and not public.is_admin(v_caller) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Lazy unsuspend (only the narrow timed-false-reports case).
  update public.users
     set account_status       = 'active',
         account_status_until = null
   where user_id = p_user_id
     and account_status = 'suspended_for_false_reports'
     and account_status_until is not null
     and account_status_until <= now();
  if found then
    insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
    values (null, 'unsuspend_user', 'user', p_user_id,
            jsonb_build_object('lazy', true));
  end if;

  select account_status, account_status_until
    into v_status, v_until
    from public.users where user_id = p_user_id;

  if v_status = 'active' then
    return query select true, null::text, null::timestamptz;
    return;
  end if;

  return query select
    false,
    case v_status
      when 'banned' then 'banned'
      when 'suspended_admin' then 'suspended_admin'
      when 'suspended_for_false_reports' then 'suspended_for_false_reports'
      else v_status
    end,
    v_until;
end;
$$;

revoke execute on function public.auth_check_account_gate(uuid) from public;
grant  execute on function public.auth_check_account_gate(uuid) to authenticated;
