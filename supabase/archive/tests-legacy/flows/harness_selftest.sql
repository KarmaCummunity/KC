-- flows/harness_selftest.sql | The harness must fail loudly: every assertion helper is
-- checked against a passing and a failing input, so a broken helper cannot turn a real
-- regression into a silent pass (G38).

begin;

-- Runs p_sql and requires it to fail with a harness assertion (not any other error).
create function pg_temp.expect_assert_failure(p_sql text, p_case text)
returns void
language plpgsql
as $$
declare
  v_error text;
begin
  begin
    execute p_sql;
  exception when others then
    v_error := sqlerrm;
  end;
  if v_error is null or v_error not like 'ASSERT FAILED:%' then
    raise exception 'HARNESS BROKEN: % — expected an assertion failure, got %',
      p_case, coalesce(v_error, 'success');
  end if;
end;
$$;

-- assert_true: true passes; false and NULL fail.
select kc_test.assert_true(true, 'true passes');
select pg_temp.expect_assert_failure($$ select kc_test.assert_true(false, 'x') $$, 'assert_true(false)');
select pg_temp.expect_assert_failure($$ select kc_test.assert_true(null, 'x') $$, 'assert_true(null)');

-- assert_eq: equal passes (NULL = NULL included); different and NULL-vs-value fail.
select kc_test.assert_eq(1, 1, 'equal ints pass');
select kc_test.assert_eq(null::text, null::text, 'null equals null');
select pg_temp.expect_assert_failure($$ select kc_test.assert_eq(1, 2, 'x') $$, 'assert_eq(1, 2)');
select pg_temp.expect_assert_failure($$ select kc_test.assert_eq('a'::text, null, 'x') $$, 'assert_eq(a, null)');

-- assert_raises: the expected error passes; success or a different error fail.
select kc_test.assert_raises($$ select kc_test.fail('boom') $$, 'ASSERT FAILED: boom', 'expected error passes');
select pg_temp.expect_assert_failure(
  $$ select kc_test.assert_raises('select 1', 'any_error', 'x') $$, 'assert_raises on success');
select pg_temp.expect_assert_failure(
  $$ select kc_test.assert_raises('select 1/0', 'seats_exhausted', 'x') $$, 'assert_raises on wrong error');

-- assert_row_count: matching count passes; a different count fails.
select kc_test.assert_row_count('select generate_series(1, 3)', 3, 'three rows');
select pg_temp.expect_assert_failure(
  $$ select kc_test.assert_row_count('select 1', 2, 'x') $$, 'assert_row_count mismatch');

-- Fixtures: a created user is provisioned as an active member; actors switch auth.uid().
do $$
declare
  v_user uuid := kc_test.create_user('harness_selftest');
begin
  perform kc_test.assert_eq(
    (select account_status::text from public.users where user_id = v_user), 'active',
    'created user is active');
  perform kc_test.act_as(v_user);
  perform kc_test.assert_eq(auth.uid(), v_user, 'act_as sets auth.uid()');
  perform kc_test.act_as_anon();
  perform kc_test.assert_true(auth.uid() is null, 'act_as_anon clears auth.uid()');
end $$;

rollback;

\echo '✓ flows/harness_selftest.sql passed'
