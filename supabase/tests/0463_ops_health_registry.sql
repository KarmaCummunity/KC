-- 0463_ops_health_registry.sql | Health registry contract (G42):
--   * every seeded check runs and reports ok | alert;
--   * a stuck ride booking and a ride left open after departure raise their checks;
--   * a check that tries to write is reported as `error`, changes nothing, and does not
--     stop the other checks;
--   * running the checks leaves the caller's transaction writable.

begin;

create temp table personas as
select kc_test.create_user('ops_driver')    as driver,
       kc_test.create_user('ops_passenger') as passenger;

-- Value of one check in the current report.
create function pg_temp.check_value(p_key text)
returns numeric
language sql
as $$ select value from ops.run_health_checks() where check_key = p_key $$;

create function pg_temp.check_status(p_key text)
returns text
language sql
as $$ select status from ops.run_health_checks() where check_key = p_key $$;

-- 1) Every seeded check runs on a healthy local stack (ok or alert, never error).
do $$
begin
  perform kc_test.assert_row_count('select 1 from ops.run_health_checks()', 7, 'all seven seeded checks report');
  perform kc_test.assert_row_count(
    $q$ select 1 from ops.run_health_checks() where status = 'error' $q$, 0, 'no seeded check fails to run');
end $$;

-- 2) Rides: a booking past its confirm-by deadline and a ride open 7 h after departure.
do $$
declare
  p personas;
  v_ride uuid;
  v_booking uuid;
  v_before_unconfirmed numeric := pg_temp.check_value('rides_bookings_unconfirmed');
  v_before_open numeric := pg_temp.check_value('rides_open_after_departure');
begin
  select * into p from personas;
  v_ride := kc_test.create_ride_offer(p.driver, p_seats => 2);
  v_booking := kc_test.book_ride(p.passenger, v_ride);
  update public.giving_handoffs set confirm_by = now() - interval '1 minute' where handoff_id = v_booking;
  perform kc_test.assert_eq(pg_temp.check_value('rides_bookings_unconfirmed'), v_before_unconfirmed + 1,
    'a booking past confirm-by is counted');
  perform kc_test.assert_eq(pg_temp.check_status('rides_bookings_unconfirmed'), 'alert',
    'an unconfirmed booking raises the check (threshold 0)');

  perform kc_test.create_ride_offer(p.driver, p_departs_in => interval '-7 hours');
  perform kc_test.assert_eq(pg_temp.check_value('rides_open_after_departure'), v_before_open + 1,
    'a ride open 7 h after departure is counted');
end $$;

-- 3) A check that writes is reported as error, its write is rolled back, the rest still run.
create function ops.check_kc_test_writes()
returns ops.health_result
language plpgsql
as $$
begin
  update ops.health_checks set description = 'tampered' where check_key = 'matching_errors';
  return row(0, 'should never be seen')::ops.health_result;
end;
$$;

insert into ops.health_checks (check_key, area, description, severity, threshold, check_function)
values ('kc_test_writes', 'platform', 'test-only check that writes', 'warning', 0, 'ops.check_kc_test_writes()');

do $$
begin
  perform kc_test.assert_eq(pg_temp.check_status('kc_test_writes'), 'error', 'a writing check is reported as error');
  perform kc_test.assert_eq(
    (select detail from ops.run_health_checks() where check_key = 'kc_test_writes'),
    'check could not run (SQLSTATE 25006)', 'the error detail carries the SQLSTATE only');
  perform kc_test.assert_eq(
    (select description from ops.health_checks where check_key = 'matching_errors'),
    'Listings whose automatic matching failed in the last 24 h', 'the attempted write did not land');
  perform kc_test.assert_row_count('select 1 from ops.run_health_checks()', 8, 'the other checks still report');
end $$;

-- 4) The caller's transaction stays writable after a run.
do $$
begin
  perform ops.run_health_checks();
  perform kc_test.assert_eq(current_setting('transaction_read_only'), 'off', 'caller transaction stays writable');
end $$;

-- 5) The registry rejects malformed rows.
do $$
begin
  perform kc_test.assert_raises(
    $q$ insert into ops.health_checks (check_key, area, description, severity, threshold, check_function)
        values ('Bad Key', 'platform', 'x', 'warning', 0, 'ops.check_matching_errors()') $q$,
    'new row for relation "health_checks" violates check constraint "health_checks_check_key_check"',
    'a malformed check key is rejected');
  perform kc_test.assert_raises(
    $q$ insert into ops.health_checks (check_key, area, description, severity, threshold, check_function)
        values ('bad_severity', 'platform', 'x', 'urgent', 0, 'ops.check_matching_errors()') $q$,
    'new row for relation "health_checks" violates check constraint "health_checks_severity_check"',
    'an unknown severity is rejected');
end $$;

rollback;

\echo '✓ 0463_ops_health_registry.sql passed'
