-- 0694_fsm_handoffs | Wave 2 of the FSM kernel program (#1989, G61)
--
-- `post_handoffs.status` moves onto the kernel (0680). One table holds every world's
-- handoffs, so four machines share it and `world_slug` picks the one that rules a row
-- (docs/architecture/state-machines.md §3.1, wave 2):
--
--   giving_handoff      items, food, animals, knowledge, and any other world
--   ride_booking        rides
--   housing_booking     housing
--   event_registration  time
--
-- 1. Catalog rows, equal to the machines in @kc/domain `fsm/machines/` (the contract test
--    replays them). Every edge is a move a live writer performs today; roles come with 1c.
-- 2. `kc_private.handoff_machine_of(world_slug)`: the world → machine rule
--    (TS copy: `handoffMachineFor`).
-- 3. `post_handoffs_status_fsm` (before update of status): every status write is checked
--    against its machine. A same-status write is a no-op (the `giving_handoffs` view
--    rewrites `status` on every update). The writers' own guards (owner, time windows,
--    seats) stay in the RPCs, before the write.
-- 4. `giving_handoff_no_show_sweep` (0666) acts on the giving machine's worlds only (no
--    other machine has `confirmed → no_show` from a pickup window) and writes the post
--    only; its write through the `listings` view repeated the direct one.

-- ── 1. Catalog ─────────────────────────────────────────────────────────────────
insert into public.fsm_state (machine_id, status) values
  ('giving_handoff', 'reserved'),
  ('giving_handoff', 'confirmed'),
  ('giving_handoff', 'handed_over'),
  ('giving_handoff', 'cancelled'),
  ('giving_handoff', 'no_show'),
  ('ride_booking', 'reserved'),
  ('ride_booking', 'confirmed'),
  ('ride_booking', 'handed_over'),
  ('ride_booking', 'cancelled'),
  ('housing_booking', 'reserved'),
  ('housing_booking', 'confirmed'),
  ('housing_booking', 'handed_over'),
  ('housing_booking', 'cancelled'),
  ('housing_booking', 'no_show'),
  ('event_registration', 'waitlisted'),
  ('event_registration', 'reserved'),
  ('event_registration', 'confirmed'),
  ('event_registration', 'handed_over'),
  ('event_registration', 'cancelled'),
  ('event_registration', 'no_show');

insert into public.fsm_edge (machine_id, from_status, to_status, role) values
  ('giving_handoff', 'reserved', 'confirmed', ''),
  ('giving_handoff', 'reserved', 'handed_over', ''),
  ('giving_handoff', 'reserved', 'cancelled', ''),
  ('giving_handoff', 'confirmed', 'handed_over', ''),
  ('giving_handoff', 'confirmed', 'cancelled', ''),
  ('giving_handoff', 'confirmed', 'no_show', ''),
  ('ride_booking', 'reserved', 'confirmed', ''),
  ('ride_booking', 'reserved', 'handed_over', ''),
  ('ride_booking', 'reserved', 'cancelled', ''),
  ('ride_booking', 'confirmed', 'handed_over', ''),
  ('ride_booking', 'confirmed', 'cancelled', ''),
  ('ride_booking', 'cancelled', 'reserved', ''),
  ('ride_booking', 'cancelled', 'confirmed', ''),
  ('housing_booking', 'reserved', 'confirmed', ''),
  ('housing_booking', 'reserved', 'cancelled', ''),
  ('housing_booking', 'confirmed', 'handed_over', ''),
  ('housing_booking', 'confirmed', 'cancelled', ''),
  ('housing_booking', 'confirmed', 'no_show', ''),
  ('event_registration', 'waitlisted', 'reserved', ''),
  ('event_registration', 'waitlisted', 'confirmed', ''),
  ('event_registration', 'waitlisted', 'cancelled', ''),
  ('event_registration', 'reserved', 'confirmed', ''),
  ('event_registration', 'reserved', 'cancelled', ''),
  ('event_registration', 'confirmed', 'handed_over', ''),
  ('event_registration', 'confirmed', 'cancelled', ''),
  ('event_registration', 'confirmed', 'no_show', ''),
  ('event_registration', 'no_show', 'handed_over', '');

-- ── 2. World → machine ─────────────────────────────────────────────────────────
create or replace function kc_private.handoff_machine_of(p_world_slug text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_world_slug
    when 'rides' then 'ride_booking'
    when 'housing' then 'housing_booking'
    when 'time' then 'event_registration'
    else 'giving_handoff'
  end;
$$;

comment on function kc_private.handoff_machine_of(text) is
  'FSM wave 2 (0694): the kernel machine that rules a post_handoffs row of this world; TS copy handoffMachineFor (@kc/domain).';

revoke all on function kc_private.handoff_machine_of(text) from public, anon, authenticated;

-- ── 3. The status trigger ──────────────────────────────────────────────────────
create or replace function kc_private.post_handoffs_enforce_status_fsm()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_machine text := kc_private.handoff_machine_of(new.world_slug);
begin
  -- Same status: not a transition (the view and several RPCs rewrite it unchanged).
  if new.status is not distinct from old.status then
    return new;
  end if;

  begin
    perform public.fsm_assert_transition(v_machine, old.status, new.status, null);
  exception
    when sqlstate 'P0001' then
      if sqlerrm in ('illegal_transition', 'unknown_state') then
        raise exception 'handoff_status_transition_invalid'
          using errcode = '23514',
                detail = format('%s: invalid status transition from %s to %s',
                                v_machine, old.status, new.status);
      end if;
      raise;
  end;

  return new;
end;
$$;

comment on function kc_private.post_handoffs_enforce_status_fsm() is
  'FSM wave 2 (0694): post_handoffs.status moves follow the machine of the row''s world in fsm_edge; raises handoff_status_transition_invalid (23514) otherwise.';

revoke all on function kc_private.post_handoffs_enforce_status_fsm() from public, anon, authenticated;

drop trigger if exists post_handoffs_status_fsm on public.post_handoffs;
create trigger post_handoffs_status_fsm
  before update of status on public.post_handoffs
  for each row execute function kc_private.post_handoffs_enforce_status_fsm();

-- ── 4. No-show sweep on the giving machine's worlds ────────────────────────────
-- Hourly: a confirmed pickup whose window ended more than 2 hours ago is a no-show, and an
-- open post it held goes back to immediately available.
create or replace function public.giving_handoff_no_show_sweep()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  v_handoff record; -- a confirmed pickup past its window
begin
  for v_handoff in
    select handoff_id, post_id
      from public.post_handoffs
     where status = 'confirmed'
       and kc_private.handoff_machine_of(world_slug) = 'giving_handoff'
       and pickup_window_end is not null
       and pickup_window_end < now() - interval '2 hours'
  loop
    update public.post_handoffs
       set status = 'no_show', no_show_at = now()
     where handoff_id = v_handoff.handoff_id;
    update public.posts
       set availability_status = 'immediate', updated_at = now()
     where post_id = v_handoff.post_id and status = 'open';
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

comment on function public.giving_handoff_no_show_sweep() is
  'Hourly: confirmed giving pickups 2 hours past their window become no_show; the post returns to immediately available (0694: giving worlds only, posts only).';

revoke all on function public.giving_handoff_no_show_sweep() from public, anon, authenticated;
grant execute on function public.giving_handoff_no_show_sweep() to service_role;
