-- FSM kernel: unknown states, illegal moves and role-restricted edges are rejected.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(8);

insert into kc_private.fsm_state (machine_id, status) values
  ('probe', 'draft'), ('probe', 'open'), ('probe', 'closed');
insert into kc_private.fsm_edge (machine_id, from_status, to_status, role) values
  ('probe', 'draft', 'open', ''),
  ('probe', 'open', 'closed', 'owner');

select lives_ok(
  $$select kc_private.fsm_assert_transition('probe', 'draft', 'open')$$,
  'an unrestricted edge admits a caller without a role');
select lives_ok(
  $$select kc_private.fsm_assert_transition('probe', 'open', 'open')$$,
  'writing the same status again is a no-op');
select lives_ok(
  $$select kc_private.fsm_assert_transition('probe', 'open', 'closed', 'owner')$$,
  'a restricted edge admits its role');
select throws_ok(
  $$select kc_private.fsm_assert_transition('probe', 'open', 'closed')$$,
  'P0001', 'forbidden_role', 'a restricted edge fails closed without a role');
select throws_ok(
  $$select kc_private.fsm_assert_transition('probe', 'open', 'closed', 'admin')$$,
  'P0001', 'forbidden_role', 'a restricted edge rejects another role');
select throws_ok(
  $$select kc_private.fsm_assert_transition('probe', 'closed', 'open')$$,
  'P0001', 'illegal_transition', 'a move without an edge is rejected');
select throws_ok(
  $$select kc_private.fsm_assert_transition('probe', 'open', 'archived')$$,
  'P0001', 'unknown_state', 'a state outside the machine is rejected');
select throws_ok(
  $$select kc_private.fsm_assert_transition('missing', 'open', 'open')$$,
  'P0001', 'unknown_state', 'an unknown machine is rejected');

select * from finish();
rollback;
