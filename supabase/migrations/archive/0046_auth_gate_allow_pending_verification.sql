-- 0046 — Fix false "permanently blocked" for new Google users (FR-AUTH-003).
-- `auth_check_account_gate` (0038) only returned allowed=true for account_status
-- `active`, so `pending_verification` incorrectly hit the deny branch with reason
-- `pending_verification`; the mobile screen defaulted unknown reasons to the banned
-- copy. Align with 0038 header comment: pending_verification passes the gate.

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

  if v_status = 'active' or v_status = 'pending_verification' then
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
