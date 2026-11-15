-- 0717_fsm_review_queues | Wave 4c of the FSM kernel program (#1989, G61)
--
-- The operator review queues share one shape (pending → approved | rejected). Their writers each
-- check `pending` before deciding; the kernel now holds the graph for every writer.
--
-- 1. Machine `review_decision` (both decisions final): `org_applications.status`,
--    `bot_admin_review_items.status`, `claim_requests.status`.
-- 2. Machine `donation_link_review`: the same decisions, and an edited link goes back to
--    `pending` from either one (`donation_links_review_guard`, 0546).
-- 3. `kc_private.enforce_status_fsm(machine, column, error)`: one status-trigger body for any
--    table, so a new lifecycle on a plain status column needs only its catalog rows and a trigger.
--
-- `posts.moderation_status` (content moderation) is left out: it has no update writer yet, so it
-- has no moves to hold.

-- ── 1. Catalog ─────────────────────────────────────────────────────────────────
insert into public.fsm_state (machine_id, status) values
  ('review_decision', 'pending'),
  ('review_decision', 'approved'),
  ('review_decision', 'rejected');

insert into public.fsm_edge (machine_id, from_status, to_status, role) values
  ('review_decision', 'pending', 'approved', ''),
  ('review_decision', 'pending', 'rejected', '');

insert into public.fsm_state (machine_id, status) values
  ('donation_link_review', 'pending'),
  ('donation_link_review', 'approved'),
  ('donation_link_review', 'rejected');

insert into public.fsm_edge (machine_id, from_status, to_status, role) values
  ('donation_link_review', 'pending', 'approved', ''),
  ('donation_link_review', 'pending', 'rejected', ''),
  ('donation_link_review', 'approved', 'pending', ''),
  ('donation_link_review', 'rejected', 'pending', '');

-- ── 2. One status-trigger body for any table ───────────────────────────────────
-- Trigger arguments: the machine id, the status column, the error code raised (23514) for a move
-- outside the graph. A same-status write is not a transition.
create or replace function kc_private.enforce_status_fsm()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_machine text := tg_argv[0];
  v_column  text := tg_argv[1];
  v_error   text := tg_argv[2];
  v_from    text := to_jsonb(old) ->> v_column;
  v_to      text := to_jsonb(new) ->> v_column;
begin
  if v_to is not distinct from v_from then
    return new;
  end if;

  begin
    perform public.fsm_assert_transition(v_machine, v_from, v_to, null);
  exception
    when sqlstate 'P0001' then
      if sqlerrm in ('illegal_transition', 'unknown_state') then
        raise exception '%', v_error
          using errcode = '23514',
                detail = format('invalid %s transition from %s to %s', v_machine, v_from, v_to);
      end if;
      raise;
  end;

  return new;
end;
$$;

comment on function kc_private.enforce_status_fsm() is
  'FSM kernel (0717): generic status trigger. Args: machine id, status column, error code; raises that code (23514) for a move outside the machine in fsm_edge.';

revoke all on function kc_private.enforce_status_fsm() from public, anon, authenticated;

-- ── 3. Triggers ────────────────────────────────────────────────────────────────
drop trigger if exists org_applications_status_fsm on public.org_applications;
create trigger org_applications_status_fsm
  before update of status on public.org_applications
  for each row execute function kc_private.enforce_status_fsm(
    'review_decision', 'status', 'org_application_transition_invalid');

drop trigger if exists bot_admin_review_items_status_fsm on public.bot_admin_review_items;
create trigger bot_admin_review_items_status_fsm
  before update of status on public.bot_admin_review_items
  for each row execute function kc_private.enforce_status_fsm(
    'review_decision', 'status', 'bot_review_transition_invalid');

drop trigger if exists claim_requests_status_fsm on public.claim_requests;
create trigger claim_requests_status_fsm
  before update of status on public.claim_requests
  for each row execute function kc_private.enforce_status_fsm(
    'review_decision', 'status', 'claim_request_transition_invalid');

-- Every UPDATE, not `update of review_status`: an edited link is sent back to `pending` by
-- `donation_links_review_guard`, which runs first (triggers fire in name order) and does not
-- name the column in the statement.
drop trigger if exists donation_links_review_status_fsm on public.donation_links;
create trigger donation_links_review_status_fsm
  before update on public.donation_links
  for each row execute function kc_private.enforce_status_fsm(
    'donation_link_review', 'review_status', 'donation_link_review_transition_invalid');
