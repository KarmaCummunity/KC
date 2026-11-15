-- supabase/tests/0193_rls_super_admin_reads.sql
-- Regression for migration 0193.
--
-- The RLS SELECT policies on donation_links, ride_emergency_events and ride_ratings
-- used to test super-admin via `exists (select 1 from public.users where ... is_super_admin)`.
-- After 0163 revoked the is_super_admin column grant from `authenticated`, evaluating
-- those policies raised `permission denied for table users` (SQLSTATE 42501 → HTTP 403)
-- for ANY authenticated reader. 0193 swaps the subquery for the SECURITY DEFINER helper
-- has_admin_role(auth.uid(),'super_admin').
--
-- This test runs as the `authenticated` role (the harness otherwise runs as postgres,
-- which bypasses RLS). Pre-0193 the reads below raise; post-0193 they succeed. The whole
-- file runs in a rolled-back transaction so it leaves no rows behind.

begin;

-- Confirm authenticated genuinely lacks the column grant the old policy depended on.
do $$
begin
  if has_column_privilege('authenticated', 'public.users', 'is_super_admin', 'SELECT') then
    raise exception 'PRECONDITION FAILED: authenticated should NOT have SELECT on users.is_super_admin (TD-163)';
  end if;
end $$;

-- Helper: create a confirmed auth user + matching public.users row (mirrors 0048).
create or replace function pg_temp.mk_user(p_handle text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, aud, role)
  values (v_id, p_handle || '@test.local', now(),
          jsonb_build_object('full_name', 'Display ' || p_handle),
          jsonb_build_object('provider', 'email'),
          'authenticated', 'authenticated');
  update public.users
     set share_handle = p_handle, display_name = 'Display ' || p_handle,
         privacy_mode = 'Public', account_status = 'active'
   where user_id = v_id;
  return v_id;
end $$;

-- Seed an owner + a visible (approved) transport link, then impersonate a DIFFERENT non-admin viewer.
do $$
declare
  v_owner  uuid := pg_temp.mk_user('t193o_' || substr(gen_random_uuid()::text, 1, 8));
  v_viewer uuid := pg_temp.mk_user('t193v_' || substr(gen_random_uuid()::text, 1, 8));
begin
  insert into public.donation_links (id, category_slug, url, display_name, submitted_by, validated_at)
  values (gen_random_uuid(), 'transport', 'https://example.com/donate-193', 'Charity 193', v_owner, now());
  -- D9 (0546): a new link waits for review; approve it (as the table owner) so it is visible.
  update public.donation_links set review_status = 'approved'
   where url = 'https://example.com/donate-193';

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_viewer::text, 'role', 'authenticated')::text,
    true
  );
end $$;

set local role authenticated;

-- As a plain authenticated user: these all raised 42501 before 0193. ON_ERROR_STOP=1
-- means any raise fails the CI step.
do $$
declare n_links int;
begin
  select count(*) into n_links
    from public.donation_links
   where category_slug = 'transport' and hidden_at is null;
  if n_links < 1 then
    raise exception 'ASSERT FAILED: expected >=1 visible transport link, got %', n_links;
  end if;

  perform count(*) from public.ride_emergency_events;
  perform count(*) from public.ride_ratings;

  raise notice '✓ 0193: authenticated reads succeeded (visible transport links=%)', n_links;
end $$;

reset role;
rollback;

\echo '✓ 0193 RLS super-admin reads regression test passed'
