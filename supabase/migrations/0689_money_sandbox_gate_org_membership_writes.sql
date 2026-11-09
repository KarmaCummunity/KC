-- 0689_money_sandbox_gate_org_membership_writes
--
-- 1. Organization memberships are written by migrations, seeds and SECURITY DEFINER
--    functions only. No app path inserts them from the client, so the client insert
--    policy and table write grants go.
-- 2. Sandbox donation completion (no real charge) runs only where the server flag
--    `sandbox_payments` is on. The flag is on for the kc-dev database (detected by its
--    seed, as in 0400) and off everywhere else, so a mock payment can never produce a
--    payment row, a receipt or a raised total outside the test environment.
--    The original body is kept as-is and renamed; a thin guard takes its public name.

begin;

-- ── 1. org_memberships: no direct client writes ──────────────────────────────
drop policy if exists org_memberships_self_insert on public.org_memberships;
revoke insert, update, delete, truncate on table public.org_memberships from anon, authenticated;

-- ── 2. sandbox_payments server flag ──────────────────────────────────────────
insert into public.app_flags (key, enabled, description)
values (
  'sandbox_payments',
  false,
  'Server gate for complete_sandbox_donation (mock checkout, no real charge). On only in the kc-dev environment.'
)
on conflict (key) do nothing;

-- kc-dev carries the fake seed (>= 100 seed users); turn the sandbox on there only.
do $guard$
declare
  v_seed_users int;
begin
  select count(*) into v_seed_users
    from auth.users
   where email like '%@seed.kc.test'
     and coalesce(raw_app_meta_data->>'seed', '') = 'true';

  if v_seed_users >= 100 then
    update public.app_flags set enabled = true, updated_at = now() where key = 'sandbox_payments';
  end if;
end
$guard$;

-- ── 3. Guarded sandbox completion ────────────────────────────────────────────
-- Keep the 0362 body untouched under an internal name that clients cannot execute.
alter function public.complete_sandbox_donation(uuid) rename to complete_sandbox_donation_unchecked;
revoke all on function public.complete_sandbox_donation_unchecked(uuid) from public, anon, authenticated;

comment on function public.complete_sandbox_donation_unchecked(uuid) is
  'Internal (0362 body). Called only by complete_sandbox_donation after the sandbox_payments gate.';

create or replace function public.complete_sandbox_donation(p_intent_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Fail closed: a missing flag row counts as off.
  if not coalesce((select enabled from public.app_flags where key = 'sandbox_payments'), false) then
    raise exception 'sandbox_payments_disabled' using errcode = '42501';
  end if;
  -- auth.uid() still resolves inside the internal function: same session, same JWT claims.
  return public.complete_sandbox_donation_unchecked(p_intent_id);
end;
$$;

comment on function public.complete_sandbox_donation(uuid) is
  'Mock checkout completion for the money world. Raises sandbox_payments_disabled unless app_flags.sandbox_payments is on.';

revoke all on function public.complete_sandbox_donation(uuid) from public, anon;
grant execute on function public.complete_sandbox_donation(uuid) to authenticated;

commit;
