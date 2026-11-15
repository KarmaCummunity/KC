-- 0067 — MVP: enforce email verification at the auth boundary, sync
-- auth.users.email_confirmed_at → public.users.account_status, and revert
-- the pending_verification exception that 0046 added to auth_check_account_gate.
--
-- After this migration:
--   • Google / Apple / phone users land as 'active' on first INSERT (unchanged from 0008).
--   • Email/password users land as 'pending_verification' on first INSERT.
--     Supabase Auth blocks signInWithPassword for them; they cannot reach the gate.
--   • When the user clicks the verification link, auth.users.email_confirmed_at
--     flips from NULL to a timestamp; the new trigger promotes
--     public.users.account_status from 'pending_verification' to 'active'.
--   • A one-time backfill cleans up legacy rows whose auth user verified
--     before this migration but whose public row was never synced.
--   • auth_check_account_gate denies 'pending_verification' (restoring 0038
--     semantics); defense in depth for stale sessions that predate this deploy.

-- ── 1. handle_email_confirmed: trigger function on auth.users UPDATE ───────
create or replace function public.handle_email_confirmed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email_confirmed_at is not null
     and old.email_confirmed_at is null then
    update public.users
       set account_status = 'active'
     where user_id = new.id
       and account_status = 'pending_verification';
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_confirmed on auth.users;
create trigger on_auth_user_email_confirmed
  after update of email_confirmed_at on auth.users
  for each row
  execute function public.handle_email_confirmed();

-- ── 2. One-time backfill ─────────────────────────────────────────────────
-- Idempotent: re-running it touches zero rows after the first pass.
update public.users u
   set account_status = 'active'
  from auth.users au
 where u.user_id = au.id
   and u.account_status = 'pending_verification'
   and au.email_confirmed_at is not null;

-- ── 3. auth_check_account_gate: revert to deny pending_verification ──────
-- Body is identical to 0038 (which 0046 patched). We keep the lazy-unsuspend
-- branch from 0038; only the 'or v_status = pending_verification' allow
-- clause introduced by 0046 is removed.
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
