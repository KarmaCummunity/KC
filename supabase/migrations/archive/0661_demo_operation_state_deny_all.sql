-- 0661_demo_operation_state_deny_all | admin demo-data portal (0654, 0657), FR-RIDE-003 (0638)
--
-- kc_dev_demo_operation_state and ride_listing_house_numbers had RLS enabled with no policy.
-- Same as kc_dev_demo_config (0591): an explicit deny-all policy (the RLS lint wants every table
-- to carry one); clients never read or write these tables, only SECURITY DEFINER functions
-- (and the service role) do.

begin;

drop policy if exists kc_dev_demo_operation_state_deny_all on public.kc_dev_demo_operation_state;
create policy kc_dev_demo_operation_state_deny_all on public.kc_dev_demo_operation_state
  for all to anon, authenticated
  using (false) with check (false);
revoke all on public.kc_dev_demo_operation_state from public, anon, authenticated;

drop policy if exists ride_listing_house_numbers_deny_all on public.ride_listing_house_numbers;
create policy ride_listing_house_numbers_deny_all on public.ride_listing_house_numbers
  for all to anon, authenticated
  using (false) with check (false);
revoke all on public.ride_listing_house_numbers from public, anon, authenticated;

commit;
