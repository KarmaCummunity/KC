-- 0719_fsm_recurring | Wave 6a of the FSM kernel program (#1989, G61)
--
-- The two recurring lifecycles move onto the kernel. They share a shape (pause and resume, then
-- a final cancel), but each has its own machine so either can grow on its own (a standing order
-- gains provider states with the payment webhook, G8).
--
-- 1. Machine `ride_series` (`ride_series.status`, FR-RIDE-046 AC6), equal to `rideSeriesMachine`.
-- 2. Machine `standing_order` (`standing_orders.status`, 0269 / 0363), equal to
--    `standingOrderMachine`.
-- 3. A status trigger on each table, on the generic body (0717).
-- 4. `cancel_standing_order` no longer re-stamps an order that is already cancelled: cancelling
--    again returns the order as it is, so its `cancelled_at` keeps the first cancellation.

-- ── 1–2. Catalog ───────────────────────────────────────────────────────────────
insert into public.fsm_state (machine_id, status) values
  ('ride_series', 'active'),
  ('ride_series', 'paused'),
  ('ride_series', 'cancelled'),
  ('standing_order', 'active'),
  ('standing_order', 'paused'),
  ('standing_order', 'cancelled');

insert into public.fsm_edge (machine_id, from_status, to_status, role) values
  ('ride_series', 'active', 'paused', ''),
  ('ride_series', 'paused', 'active', ''),
  ('ride_series', 'active', 'cancelled', ''),
  ('ride_series', 'paused', 'cancelled', ''),
  ('standing_order', 'active', 'paused', ''),
  ('standing_order', 'paused', 'active', ''),
  ('standing_order', 'active', 'cancelled', ''),
  ('standing_order', 'paused', 'cancelled', '');

-- ── 3. Status triggers ─────────────────────────────────────────────────────────
-- `set_ride_series_status` refuses a cancelled series first (`ride_series_cancelled`, 0531); the
-- trigger holds the graph for every other writer.
drop trigger if exists ride_series_status_fsm on public.ride_series;
create trigger ride_series_status_fsm
  before update of status on public.ride_series
  for each row execute function kc_private.enforce_status_fsm(
    'ride_series', 'status', 'ride_series_transition_invalid');

drop trigger if exists standing_orders_status_fsm on public.standing_orders;
create trigger standing_orders_status_fsm
  before update of status on public.standing_orders
  for each row execute function kc_private.enforce_status_fsm(
    'standing_order', 'status', 'standing_order_transition_invalid');

-- ── 4. cancel_standing_order: a second cancel changes nothing ──────────────────
-- Errors: order_not_found (P0002) when the caller has no such order.
create or replace function public.cancel_standing_order(p_order_id uuid)
returns public.standing_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.standing_orders;
begin
  select * into v_row
    from public.standing_orders
   where order_id = p_order_id and user_id = auth.uid()
   for update;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;

  -- Already cancelled: the first cancellation and its time stand.
  if v_row.status = 'cancelled' then
    return v_row;
  end if;

  update public.standing_orders
     set status = 'cancelled', cancelled_at = now()
   where order_id = p_order_id
  returning * into v_row;
  return v_row;
end;
$$;

comment on function public.cancel_standing_order(uuid) is
  'Money (0719): cancels the caller''s active or paused standing order for good; cancelling a cancelled order returns it unchanged.';

revoke all on function public.cancel_standing_order(uuid) from public, anon;
grant execute on function public.cancel_standing_order(uuid) to authenticated;
