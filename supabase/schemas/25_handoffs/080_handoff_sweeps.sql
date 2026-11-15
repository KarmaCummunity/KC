-- Handoffs · sweeps (run by the scheduler as the service role)
--
-- Time-driven moves, all in the machine role `system`. Each is safe to run concurrently
-- with itself and with member actions: rows are claimed with SKIP LOCKED and re-checked by
-- the machine on the move.

-- A reservation the owner did not answer by `confirm_by` lapses (`expired`), in every
-- world: the seat is free again and both members are notified (FR-NOTIF-018 AC3b). Before,
-- only some worlds swept the deadline and a stale request could hold a post indefinitely.
create function kc_private.handoff_reservation_expiry_sweep(p_limit integer default 500)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_handoff_id uuid;
  v_count integer := 0;
begin
  for v_handoff_id in
    select h.id from public.post_handoffs h
     where h.status = 'reserved' and h.confirm_by < now()
     order by h.confirm_by
     limit least(greatest(p_limit, 1), 5000)
       for update skip locked
  loop
    perform kc_private.handoff_move(v_handoff_id, 'cancelled', 'system', 'expired');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
comment on function kc_private.handoff_reservation_expiry_sweep(integer) is
  'Cancels reservations left unanswered past confirm_by; returns how many.';

-- A confirmed pickup of the giving machine whose window ended more than two hours ago is a
-- no-show: the handoff ends and the post, still open, can be taken by someone else. Stays
-- and events record a no-show by hand; rides have none.
create function kc_private.handoff_no_show_sweep(p_limit integer default 500)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_handoff_id uuid;
  v_count integer := 0;
begin
  for v_handoff_id in
    select h.id from public.post_handoffs h
     where h.status = 'confirmed' and h.machine_id = 'giving_handoff'
       and h.pickup_window_end < now() - interval '2 hours'
     order by h.pickup_window_end
     limit least(greatest(p_limit, 1), 5000)
       for update skip locked
  loop
    perform kc_private.handoff_move(v_handoff_id, 'no_show', 'system');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
comment on function kc_private.handoff_no_show_sweep(integer) is
  'Marks confirmed pickups two hours past their window as no_show; returns how many.';
