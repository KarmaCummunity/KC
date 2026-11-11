-- supabase/tests/0377_volunteer_signup_flow.sql | Sign-up + check-in RPC smoke

begin;

create or replace function pg_temp.mk_user(p_id uuid, p_handle text)
returns void language plpgsql as $$
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, aud, role)
  values (p_id, p_handle || '@test.local', now(),
          jsonb_build_object('full_name', 'Display ' || p_handle),
          jsonb_build_object('provider', 'email'),
          'authenticated', 'authenticated');
  update public.users
     set share_handle = p_handle, display_name = 'Display ' || p_handle,
         account_status = 'active', privacy_mode = 'Public'
   where user_id = p_id;
end $$;

do $$
declare
  v_org uuid := '00000000-0000-0000-0000-000000000001';
  v_organizer uuid := '00000000-0000-0000-0000-000000370001';
  v_vol uuid := '00000000-0000-0000-0000-000000370002';
  v_opp uuid;
  v_shift uuid;
  v_signup public.volunteer_shift_signups;
  v_check jsonb;
begin
  perform pg_temp.mk_user(v_organizer, 'volorg370');
  perform pg_temp.mk_user(v_vol, 'volusr370');

  perform set_config('request.jwt.claim.sub', v_organizer::text, true);
  perform set_config('role', 'authenticated', true);

  v_opp := public.create_volunteer_opportunity('Test pantry shift', 'Help sort food', 'Tel Aviv', null, v_org);
  v_shift := public.add_volunteer_shift(v_opp, now() + interval '1 hour', now() + interval '3 hours', 2);
  perform public.publish_volunteer_opportunity(v_opp);

  perform set_config('request.jwt.claim.sub', v_vol::text, true);
  v_signup := public.sign_up_volunteer_shift(v_shift);
  if v_signup.status <> 'registered' then
    raise exception 'ASSERT FAILED: expected registered signup';
  end if;

  -- Check-in is self-service: the volunteer checks themselves in.
  v_check := public.check_in_volunteer_shift(v_signup.signup_id);
  if (v_check->>'hours_logged') is null then
    raise exception 'ASSERT FAILED: check-in should return hours';
  end if;
end $$;

rollback;
