-- 0637_users_verification_level | FR-VERIFY-001, FR-VERIFY-012
begin;

create temp table t_user as select kc_test.create_user('verify_level') as id;

do $$
declare
  v_uid uuid := (select id from t_user);
  v_city text := (select city_id from public.cities limit 1);
begin
  perform kc_test.assert_eq(public.user_verification_level(v_uid), 0::smallint, 'new member is level 0');

  update public.users
     set city = v_city,
         date_of_birth = date '1990-01-01',
         avatar_url = 'https://example.test/a.png',
         profile_street = 'Herzl',
         profile_street_number = '12',
         contact_phone = '0501234567'
   where user_id = v_uid;
  perform kc_test.assert_eq(
    (select verification_level from public.users where user_id = v_uid), 1::smallint,
    'all complete-profile fields filled -> level 1 stored by trigger');
  perform kc_test.assert_eq(public.user_verification_level(v_uid), 1::smallint, 'function agrees with column');

  update public.users set contact_phone = null where user_id = v_uid;
  perform kc_test.assert_eq(
    (select verification_level from public.users where user_id = v_uid), 0::smallint,
    'missing contact phone drops back to level 0');

  update public.users set contact_phone = '0501234567', avatar_url = null where user_id = v_uid;
  perform kc_test.assert_eq(
    (select verification_level from public.users where user_id = v_uid), 0::smallint,
    'missing avatar drops back to level 0');

  update public.users set verified_at = now(), verification_method = 'manual' where user_id = v_uid;
  perform kc_test.assert_eq(
    (select verification_level from public.users where user_id = v_uid), 2::smallint,
    'manual ID verification -> level 2');

  update public.users set verification_method = 'org_vouch' where user_id = v_uid;
  perform kc_test.assert_eq(
    (select verification_level from public.users where user_id = v_uid), 0::smallint,
    'org vouch is not ID level');

  update public.users set verification_level = 3 where user_id = v_uid;
  perform kc_test.assert_eq(
    (select verification_level from public.users where user_id = v_uid), 0::smallint,
    'direct writes are recomputed by the trigger');

  perform kc_test.assert_eq(public.user_verification_level(gen_random_uuid()), 0::smallint, 'unknown user is level 0');
end;
$$;

rollback;
\echo '✓ 0637_users_verification_level passed'
