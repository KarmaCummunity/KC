-- 0642_dev_mock_identity_verification | RPC is gated; manual verification reaches level 2.
begin;

do $test$
declare
  v_uid uuid;
begin
  v_uid := kc_test.create_user('mock_verify');
  perform kc_test.act_as(v_uid);
  update public.users
     set verified_at = null, verification_method = null
   where user_id = v_uid;

  if public.dev_mock_identity_verification_allowed() then
    perform public.dev_grant_mock_identity_verification();
    perform kc_test.assert_eq(
      public.user_verification_level(v_uid), 2::smallint,
      'mock grant sets level 2');
    perform kc_test.assert_true(
      public.has_accepted_housing_conduct(v_uid),
      'mock grant accepts housing conduct');
  else
    perform kc_test.assert_raises(
      'select public.dev_grant_mock_identity_verification()',
      'dev_mock_identity_verification_disabled',
      'RPC refused without dev gate');
  end if;
end $test$;

rollback;

\echo '✓ 0642_dev_mock_identity_verification passed'
