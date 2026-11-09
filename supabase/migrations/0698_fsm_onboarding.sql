-- 0698_fsm_onboarding | Wave 3b of the FSM kernel program (#1989, G61)
--
-- `users.onboarding_state` moves onto the kernel (0680). Until now the column was client-writable
-- (0196 grant) and the onboarding order lived only in the TypeScript use cases, so any member
-- could write any stage, in any order.
--
-- 1. Catalog rows for machine `onboarding`, equal to `onboardingMachine` in @kc/domain:
--    a member moves forward only (basic info → photo → completed, or basic info → completed when
--    a deferred profile is reconciled, FR-AUTH-015). The two moves back to the first step carry
--    role `dev_reset`: only the Settings developer tool takes them, on a dev database.
-- 2. `users_onboarding_state_fsm` (before update of onboarding_state): every write follows the
--    graph; a same-stage write is a no-op. The `dev_reset` role is declared by
--    `rpc_dev_reset_onboarding` alone, for its own update, through a transaction-local setting
--    (the general writer-declared role is wave 1c).
-- 3. `rpc_set_onboarding_state(p_state)`: the member's only write path. Leaving the first step
--    requires the step-1 fields on file (display name, city, date of birth; FR-AUTH-010 AC2).
-- 4. `rpc_dev_reset_onboarding()`: the Settings reset tool, allowed only where
--    `kc_dev_demo_config` marks the database as kc-dev (same gate as 0614 / 0642).
-- 5. The client's column grant on `onboarding_state` is revoked (0196 granted it).

-- ── 1. Catalog ─────────────────────────────────────────────────────────────────
insert into public.fsm_state (machine_id, status) values
  ('onboarding', 'pending_basic_info'),
  ('onboarding', 'pending_avatar'),
  ('onboarding', 'completed');

insert into public.fsm_edge (machine_id, from_status, to_status, role) values
  ('onboarding', 'pending_basic_info', 'pending_avatar', ''),
  ('onboarding', 'pending_basic_info', 'completed', ''),
  ('onboarding', 'pending_avatar', 'completed', ''),
  ('onboarding', 'pending_avatar', 'pending_basic_info', 'dev_reset'),
  ('onboarding', 'completed', 'pending_basic_info', 'dev_reset');

-- ── 2. The stage trigger ───────────────────────────────────────────────────────
create or replace function kc_private.users_enforce_onboarding_fsm()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Set to 'on' only by rpc_dev_reset_onboarding, around its own update (section 4).
  v_role text := case when current_setting('kc.onboarding_reset', true) = 'on' then 'dev_reset' end;
begin
  -- Same stage: not a transition.
  if new.onboarding_state is not distinct from old.onboarding_state then
    return new;
  end if;

  begin
    perform public.fsm_assert_transition('onboarding', old.onboarding_state, new.onboarding_state, v_role);
  exception
    when sqlstate 'P0001' then
      if sqlerrm in ('illegal_transition', 'unknown_state', 'forbidden_role') then
        raise exception 'onboarding_transition_invalid'
          using errcode = '23514',
                detail = format('invalid onboarding transition from %s to %s',
                                old.onboarding_state, new.onboarding_state);
      end if;
      raise;
  end;

  return new;
end;
$$;

comment on function kc_private.users_enforce_onboarding_fsm() is
  'FSM wave 3b (0698): users.onboarding_state moves follow machine `onboarding` in fsm_edge; raises onboarding_transition_invalid (23514) otherwise.';

revoke all on function kc_private.users_enforce_onboarding_fsm() from public, anon, authenticated;

drop trigger if exists users_onboarding_state_fsm on public.users;
create trigger users_onboarding_state_fsm
  before update of onboarding_state on public.users
  for each row execute function kc_private.users_enforce_onboarding_fsm();

-- ── 3. rpc_set_onboarding_state: the member's write path ───────────────────────
-- Errors: unauthenticated (42501), user_not_found (P0002), onboarding_basic_info_missing and
-- onboarding_transition_invalid (23514).
create or replace function public.rpc_set_onboarding_state(p_state text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row record;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  select u.onboarding_state, u.display_name, u.city, u.date_of_birth
    into v_row
    from public.users u
   where u.user_id = v_uid
   for update;
  if not found then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;

  -- Leaving step 1 needs its fields on file (FR-AUTH-010 AC2). The graph itself is the trigger's.
  if v_row.onboarding_state = 'pending_basic_info'
     and p_state is distinct from 'pending_basic_info'
     and (nullif(btrim(v_row.display_name), '') is null
          or nullif(btrim(v_row.city), '') is null
          or v_row.date_of_birth is null) then
    raise exception 'onboarding_basic_info_missing' using errcode = '23514';
  end if;

  update public.users set onboarding_state = p_state where user_id = v_uid;
end;
$$;

comment on function public.rpc_set_onboarding_state(text) is
  'FR-AUTH-010 / 012 / 015 (0698): moves the caller''s onboarding forward along machine `onboarding`; leaving step 1 needs display name, city and date of birth.';

revoke all on function public.rpc_set_onboarding_state(text) from public, anon;
grant execute on function public.rpc_set_onboarding_state(text) to authenticated;

-- ── 4. rpc_dev_reset_onboarding: the Settings developer tool ───────────────────
-- Errors: unauthenticated and onboarding_reset_dev_only (42501), user_not_found (P0002).
create or replace function public.rpc_dev_reset_onboarding()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_rows int;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  if not exists (select 1 from public.kc_dev_demo_config) then
    raise exception 'onboarding_reset_dev_only' using errcode = '42501';
  end if;

  -- Declares role `dev_reset` to the stage trigger for this update only.
  perform pg_catalog.set_config('kc.onboarding_reset', 'on', true);
  update public.users
     set onboarding_state = 'pending_basic_info',
         basic_info_skipped = false
   where user_id = v_uid;
  -- Read before the next PERFORM, which resets FOUND.
  get diagnostics v_rows = row_count;
  perform pg_catalog.set_config('kc.onboarding_reset', '', true);

  if v_rows = 0 then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
end;
$$;

comment on function public.rpc_dev_reset_onboarding() is
  'Dev databases only (kc_dev_demo_config, 0698): sends the caller back to onboarding step 1 and clears the skip flag.';

revoke all on function public.rpc_dev_reset_onboarding() from public, anon;
grant execute on function public.rpc_dev_reset_onboarding() to authenticated;

-- ── 5. The client no longer writes the stage directly ──────────────────────────
revoke update (onboarding_state) on public.users from authenticated;
