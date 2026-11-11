-- 0590 | FR-AUTH-010 AC2.d — the date of birth is private, 18+, and written through one RPC.
begin;

create temp table personas as
  select kc_test.create_user('dob_a_' || substr(gen_random_uuid()::text, 1, 6)) as a,
         kc_test.create_user('dob_b_' || substr(gen_random_uuid()::text, 1, 6)) as b;

do $$
declare
  p record;
  v_dob date;
begin
  select * into p from personas;
  perform kc_test.act_as(p.a);

  -- Valid: exactly 18 today is accepted; one day short is not.
  perform public.rpc_set_date_of_birth((current_date - interval '18 years')::date);
  perform kc_test.assert_true(
    (public.users_get_self_private_fields() ->> 'date_of_birth')::date = (current_date - interval '18 years')::date,
    'the owner reads the stored date of birth');

  perform kc_test.assert_raises(
    format('select public.rpc_set_date_of_birth(%L)', ((current_date - interval '18 years')::date + 1)),
    'underage', 'one day before the 18th birthday is underage');
  perform kc_test.assert_raises(
    format('select public.rpc_set_date_of_birth(%L)', current_date + 1),
    'invalid_date_of_birth', 'a future date is invalid');
  perform kc_test.assert_raises(
    'select public.rpc_set_date_of_birth(date ''1899-12-31'')',
    'invalid_date_of_birth', 'a date before 1900 is invalid');
  perform kc_test.assert_raises(
    'select public.rpc_set_date_of_birth(null)',
    'invalid_date_of_birth', 'null is invalid');

  -- The failed attempts left the stored value untouched.
  select (public.users_get_self_private_fields() ->> 'date_of_birth')::date into v_dob;
  perform kc_test.assert_eq(v_dob, (current_date - interval '18 years')::date, 'rejected input changes nothing');

  -- Another member never sees it.
  perform kc_test.act_as(p.b);
  perform kc_test.assert_true(
    (public.users_get_self_private_fields() ->> 'date_of_birth') is null,
    'a member without a date of birth reads null, never someone else''s');

  perform kc_test.act_as_anon();
  perform kc_test.assert_raises(
    'select public.rpc_set_date_of_birth(date ''1990-01-01'')',
    'unauthenticated', 'a signed-out caller cannot set it');

  raise notice '✓ rpc_set_date_of_birth rules';
end $$;

-- Privileges: no client can read or write the column directly.
do $$
begin
  perform kc_test.assert_true(
    not has_column_privilege('anon', 'public.users', 'date_of_birth', 'SELECT')
    and not has_column_privilege('authenticated', 'public.users', 'date_of_birth', 'SELECT'),
    'date_of_birth is not selectable by clients');
  perform kc_test.assert_true(
    not has_column_privilege('authenticated', 'public.users', 'date_of_birth', 'UPDATE'),
    'date_of_birth is not writable by a plain UPDATE');
  perform kc_test.assert_true(
    not has_function_privilege('anon', 'public.rpc_set_date_of_birth(date)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.rpc_set_date_of_birth(date)', 'EXECUTE'),
    'only signed-in members run rpc_set_date_of_birth');
  raise notice '✓ privileges';
end $$;

rollback;

\echo '✓ 0590_users_date_of_birth.sql passed'
