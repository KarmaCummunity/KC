-- 0190_karma_recompute | FR-KARMA-001 — nightly recompute detects + reconciles drift.
-- Corrupts a user's denorm, runs karma_recompute_nightly(), and asserts it
-- reconciles to greatest(0, sum(ledger)), records a drift event, and is a no-op on
-- already-consistent users. Ephemeral CI stack; on shared dev wrap in BEGIN...ROLLBACK.

create or replace function pg_temp.mk_user(p_handle text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, aud, role)
  values (v_id, p_handle || '@test.local', now(),
          jsonb_build_object('full_name', 'Display ' || p_handle),
          jsonb_build_object('provider', 'email'), 'authenticated', 'authenticated');
  update public.users
     set share_handle = p_handle, display_name = 'Display ' || p_handle, account_status = 'active'
   where user_id = v_id;
  return v_id;
end $$;

do $$
declare
  u uuid := pg_temp.mk_user('kr_' || substr(gen_random_uuid()::text,1,8));
  v_before int; v_after int; v_drift int;
begin
  -- baseline: registration trigger gave +1; ledger sum = 1
  v_before := (select karma_points from public.users where user_id = u);
  if v_before <> 1 then raise exception 'baseline expected 1, got %', v_before; end if;

  -- corrupt the denorm to simulate drift
  update public.users set karma_points = 999 where user_id = u;

  -- recompute reconciles to the ledger sum (1)
  perform public.karma_recompute_nightly();
  v_after := (select karma_points from public.users where user_id = u);
  if v_after <> 1 then raise exception 'recompute did not reconcile: got %, want 1', v_after; end if;

  -- a drift event was recorded for the corrupted user (old=999, new=1)
  select count(*) into v_drift from public.karma_drift_events
   where user_id = u and old_value = 999 and new_value = 1;
  if v_drift < 1 then raise exception 'no drift event recorded for corrupted user'; end if;

  -- idempotent: a second recompute leaves the now-consistent user untouched
  perform public.karma_recompute_nightly();
  v_after := (select karma_points from public.users where user_id = u);
  if v_after <> 1 then raise exception 'second recompute changed a consistent user: %', v_after; end if;

  raise notice '✓ karma recompute: detects drift (999→1), reconciles to ledger sum, records a drift event, idempotent on consistent users';
end $$;
