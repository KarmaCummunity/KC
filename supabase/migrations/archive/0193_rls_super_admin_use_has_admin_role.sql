-- 0193_rls_super_admin_use_has_admin_role | FR-DONATE-007..009, FR-RIDE-035, FR-RIDE-037
--
-- Fix HTTP 403 for authenticated users reading donation_links, ride_emergency_events
-- and ride_ratings (e.g. the transport links list on the rides hub).
--
-- Root cause: these RLS policies (created in 0014 / 0178 / 0179) test super-admin via
-- an inline subquery
--     exists (select 1 from public.users u
--              where u.user_id = auth.uid() and u.is_super_admin = true)
-- Migration 0163 (TD-163) revoked table-level SELECT on public.users from
-- `authenticated` and re-granted only a non-PII column projection that EXCLUDES
-- is_super_admin. PostgreSQL checks column privileges at executor startup for every
-- range-table entry in the plan, so any authenticated query whose RLS policy references
-- users.is_super_admin fails with `permission denied for table users` (SQLSTATE 42501),
-- which PostgREST surfaces as HTTP 403 — regardless of OR short-circuiting. Anon is
-- unaffected because these policies are `to authenticated`, so the users range-table
-- entry is never added to an anon plan (anon just gets an empty result).
--
-- Fix: replace the inline subquery with the SECURITY DEFINER helper
-- public.has_admin_role(auth.uid(), 'super_admin') (added 0113, already adopted by 0116
-- for exactly this reason). The helper reads admin_role_grants and runs as its owner, so
-- it does not depend on the caller holding a column grant on users.is_super_admin.
-- has_admin_role mirrors the is_super_admin denormalisation, kept in sync by the 0114
-- bidirectional triggers, so this is behaviour-preserving apart from restoring access.

begin;

-- ── donation_links (0014) ────────────────────────────────────────────────────
drop policy if exists donation_links_select_visible on public.donation_links;
create policy donation_links_select_visible on public.donation_links
  for select to authenticated using (
    hidden_at is null
    or submitted_by = auth.uid()
    or public.has_admin_role(auth.uid(), 'super_admin')
  );

drop policy if exists donation_links_update_own_or_admin on public.donation_links;
create policy donation_links_update_own_or_admin on public.donation_links
  for update to authenticated using (
    submitted_by = auth.uid()
    or public.has_admin_role(auth.uid(), 'super_admin')
  ) with check (
    submitted_by = auth.uid()
    or public.has_admin_role(auth.uid(), 'super_admin')
  );

drop policy if exists donation_links_delete_own_or_admin on public.donation_links;
create policy donation_links_delete_own_or_admin on public.donation_links
  for delete to authenticated using (
    submitted_by = auth.uid()
    or public.has_admin_role(auth.uid(), 'super_admin')
  );

-- ── ride_emergency_events (0178) ─────────────────────────────────────────────
drop policy if exists ride_emergency_events_select on public.ride_emergency_events;
create policy ride_emergency_events_select on public.ride_emergency_events
  for select to authenticated using (
    triggered_by = auth.uid()
    or exists (
      select 1 from public.ride_listings r
       where r.ride_id = public.ride_emergency_events.ride_id
         and r.owner_id = auth.uid()
    )
    or public.has_admin_role(auth.uid(), 'super_admin')
  );

-- ── ride_ratings (0179) ──────────────────────────────────────────────────────
drop policy if exists ride_ratings_select on public.ride_ratings;
create policy ride_ratings_select on public.ride_ratings
  for select to authenticated using (
    rater_id = auth.uid()
    or ratee_id = auth.uid()
    or public.has_admin_role(auth.uid(), 'super_admin')
  );

commit;
