-- Identity · account RPCs (onboarding, date of birth, account deletion)
--
-- `user_account` and `user_private.date_of_birth` are not writable from a device. These are
-- the named moves a member may make on their own account. Errors are raised with SQLSTATE
-- P0001 and a stable snake_case message the app maps to its error types.

-- ── Onboarding (FR-AUTH-010 AC5, FR-AUTH-015) ───────────────────────────────
-- Moves the caller's onboarding forward. Leaving step 1 requires a display name, a city and
-- a date of birth on file, so a modified client cannot skip the step.
create function public.set_onboarding_state(p_state text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_caller();
  v_current text;
begin
  select a.onboarding_state into v_current
    from public.user_account a where a.user_id = v_user_id for update;
  if not found then
    raise exception 'user_not_found' using errcode = 'P0001';
  end if;

  if v_current = 'pending_basic_info' and p_state is distinct from v_current and not exists (
       select 1
         from public.users u
         join public.user_private p on p.user_id = u.id
        where u.id = v_user_id
          and nullif(btrim(u.display_name), '') is not null
          and u.city_id is not null
          and p.date_of_birth is not null) then
    raise exception 'onboarding_basic_info_missing' using errcode = 'P0001';
  end if;

  begin
    update public.user_account a set onboarding_state = p_state where a.user_id = v_user_id;
  exception when sqlstate 'P0001' then
    -- The machine refused the move (backwards, or not a state): one error for the app.
    raise exception 'onboarding_transition_invalid' using errcode = 'P0001', detail = sqlerrm;
  end;
end;
$$;
comment on function public.set_onboarding_state(text) is
  'Moves the caller''s onboarding along its machine; step 1 needs name, city and date of birth.';
grant execute on function public.set_onboarding_state(text) to authenticated;

-- ── Date of birth (FR-AUTH-010 AC2.d, FR-PROFILE-007 AC7, D109) ─────────────
-- Stores the caller's date of birth. The member must be at least 18 on the day of the call;
-- a later correction is held to the same rule.
create function public.set_date_of_birth(p_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_caller();
begin
  if p_date is null or p_date > current_date or p_date < date '1900-01-01' then
    raise exception 'invalid_date_of_birth' using errcode = 'P0001';
  end if;
  if p_date > (current_date - interval '18 years')::date then
    raise exception 'underage' using errcode = 'P0001';
  end if;

  update public.user_private p set date_of_birth = p_date where p.user_id = v_user_id;
  if not found then
    raise exception 'user_not_found' using errcode = 'P0001';
  end if;
end;
$$;
comment on function public.set_date_of_birth(date) is 'Stores the caller''s date of birth; rejects anyone under 18.';
grant execute on function public.set_date_of_birth(date) to authenticated;

-- ── Account deletion: 30 days of grace (D108, FR-SETTINGS-012, FR-AUTH-016) ─
-- Whatever moves an account out of pending_deletion (a restore, or any later server move),
-- the deletion fields are cleared here, in one place, so no writer can leave them behind.
create function kc_private.user_account_leave_pending_deletion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.deletion_requested_at := null;
  new.deletion_purge_at := null;
  new.status_before_deletion := null;
  return new;
end;
$$;

create trigger user_account_leave_pending_deletion
  before update of status on public.user_account
  for each row
  when (old.status = 'pending_deletion' and new.status <> 'pending_deletion')
  execute function kc_private.user_account_leave_pending_deletion();

-- Deactivates the caller's account and returns the purge date. The profile disappears for
-- everyone else at once (users.is_active), push stops, and nothing else is removed, so a
-- restore is complete. Calling it again returns the same date. A suspended or banned
-- member cannot use it to step out of a sanction.
create function public.request_account_deletion()
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_caller();
  v_account public.user_account;
  v_purge_at constant timestamptz := now() + interval '30 days';
begin
  select a.* into v_account from public.user_account a where a.user_id = v_user_id for update;
  if not found then
    raise exception 'user_not_found' using errcode = 'P0001';
  end if;
  if v_account.status = 'pending_deletion' then
    return v_account.deletion_purge_at;
  end if;
  if v_account.status not in ('active', 'pending_verification') then
    raise exception 'suspended' using errcode = 'P0001';
  end if;

  update public.user_account a
     set status = 'pending_deletion',
         status_before_deletion = v_account.status,
         deletion_requested_at = now(),
         deletion_purge_at = v_purge_at
   where a.user_id = v_user_id;

  delete from public.user_devices d where d.user_id = v_user_id;
  return v_purge_at;
end;
$$;
comment on function public.request_account_deletion() is
  'Deactivates the caller''s account for 30 days and returns the purge date.';
grant execute on function public.request_account_deletion() to authenticated;

-- Restores the caller's account while the grace period is running. The account returns to
-- the status it had before, except that a member whose contact channel was confirmed in the
-- meantime returns as active.
create function public.restore_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_caller();
  v_account public.user_account;
begin
  select a.* into v_account from public.user_account a where a.user_id = v_user_id for update;
  if not found or v_account.status <> 'pending_deletion' then
    raise exception 'not_pending_deletion' using errcode = 'P0001';
  end if;
  if v_account.deletion_purge_at <= now() then
    raise exception 'grace_expired' using errcode = 'P0001';
  end if;

  update public.user_account a
     set status = case
           when exists (select 1 from auth.users au
                         where au.id = v_user_id and kc_private.auth_user_is_verified(au)) then 'active'
           else v_account.status_before_deletion
         end
   where a.user_id = v_user_id;
end;
$$;
comment on function public.restore_account() is 'Restores the caller''s account during the deletion grace period.';
grant execute on function public.restore_account() to authenticated;

-- Accounts whose grace period has ended, oldest first, for the daily purge job. An account
-- stays listed until its auth identity is gone, so a failed purge is retried the next day.
create function kc_private.accounts_due_for_purge(p_limit integer default 100)
returns table (user_id uuid, deletion_purge_at timestamptz)
language sql
stable
set search_path = ''
as $$
  select a.user_id, a.deletion_purge_at
    from public.user_account a
   where a.deletion_purge_at <= now()
   order by a.deletion_purge_at
   limit p_limit;
$$;
comment on function kc_private.accounts_due_for_purge(integer) is
  'Service role only: accounts past their purge date, oldest first.';
