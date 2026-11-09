begin;

select public.fsm_assert_transition('admin_task', 'open', 'in_progress', null);
select public.fsm_assert_transition('admin_task', 'open', 'open', null);

select kc_test.assert_raises(
  $$select public.fsm_assert_transition('admin_task', 'open', 'done', null)$$,
  'illegal_transition',
  'open cannot skip to done');
select kc_test.assert_raises(
  $$select public.fsm_assert_transition('admin_task', 'nope', 'open', null)$$,
  'unknown_state',
  'unknown status');

insert into public.fsm_state (machine_id, status) values
  ('fixture_gate', 'a'), ('fixture_gate', 'b'),
  ('fixture_open', 'a'), ('fixture_open', 'b');
insert into public.fsm_edge (machine_id, from_status, to_status, role) values
  ('fixture_gate', 'a', 'b', 'owner'),
  ('fixture_open', 'a', 'b', '');

select public.fsm_assert_transition('fixture_gate', 'a', 'b', 'owner');
select public.fsm_assert_transition('fixture_open', 'a', 'b', null);
select kc_test.assert_raises(
  $$select public.fsm_assert_transition('fixture_gate', 'a', 'b', 'stranger')$$,
  'forbidden_role',
  'stranger role');
select kc_test.assert_raises(
  $$select public.fsm_assert_transition('fixture_gate', 'a', 'b', null)$$,
  'forbidden_role',
  'missing role');

do $$
declare
  v_role text;
  v_table text;
  v_priv text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    foreach v_table in array array['public.fsm_state', 'public.fsm_edge'] loop
      foreach v_priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
        perform kc_test.assert_true(
          not has_table_privilege(v_role, v_table, v_priv),
          format('%s must not have %s on %s', v_role, v_priv, v_table));
      end loop;
    end loop;
    perform kc_test.assert_true(
      not has_function_privilege(
        v_role, 'public.fsm_assert_transition(text, text, text, text)', 'EXECUTE'),
      format('%s must not execute fsm_assert_transition', v_role));
  end loop;
end $$;

do $$
declare
  v_admin uuid := kc_test.create_user('fsm_admin');
  v_task uuid;
  v_changes bigint;
begin
  -- Only one super_admin may be active; the revoke is rolled back with the rest.
  update public.admin_role_grants set revoked_at = now()
   where role = 'super_admin' and revoked_at is null;
  insert into public.admin_role_grants (user_id, role) values (v_admin, 'super_admin');
  insert into public.admin_tasks (title, created_by)
  values ('fsm pilot', v_admin)
  returning task_id into v_task;
  perform kc_test.act_as(v_admin);
  perform public.admin_task_set_status(v_task, 'in_progress');
  perform kc_test.assert_eq(
    (select status from public.admin_tasks where task_id = v_task),
    'in_progress',
    'legal admin move');
  perform public.admin_task_set_status(v_task, 'in_progress');
  select count(*) into v_changes
    from public.admin_task_activities
   where task_id = v_task and kind = 'status_change';
  perform kc_test.assert_eq(v_changes, 1::bigint, 'same status writes no second activity');
  perform kc_test.assert_raises(
    format('select public.admin_task_set_status(%L, %L)', v_task, 'archived'),
    'invalid_transition',
    'in_progress cannot jump to archived');

  perform kc_test.assert_raises(
    format('update public.admin_tasks set status = %L where task_id = %L', 'archived', v_task),
    'illegal_transition',
    'trigger rejects a direct in_progress to archived update');
  perform kc_test.assert_eq(
    (select status from public.admin_tasks where task_id = v_task),
    'in_progress',
    'rejected direct update leaves the status unchanged');
  update public.admin_tasks set status = 'blocked' where task_id = v_task;
  perform kc_test.assert_eq(
    (select status from public.admin_tasks where task_id = v_task),
    'blocked',
    'trigger allows a direct legal in_progress to blocked update');
end $$;

rollback;

\echo '✓ 0679_fsm_catalog.sql passed'
