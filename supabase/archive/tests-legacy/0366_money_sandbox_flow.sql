-- supabase/tests/0366_money_sandbox_flow.sql | Sandbox donate + standing order RPCs

begin;

-- The sandbox completion is gated by a server flag since 0690; on for this transaction only.
update public.app_flags set enabled = true where key = 'sandbox_payments';

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
  v_user uuid := '00000000-0000-0000-0000-000000360001';
  v_intent public.donation_intents;
  v_done jsonb;
begin
  perform pg_temp.mk_user(v_user, 'money360');
  update public.organizations set is_verified_nonprofit = true where org_id = v_org;

  perform set_config('request.jwt.claim.sub', v_user::text, true);
  perform set_config('role', 'authenticated', true);

  v_intent := public.create_donation_intent(v_org, 36, 'idem-360-1', null);
  if v_intent.status <> 'checkout' then
    raise exception 'ASSERT FAILED: expected checkout status';
  end if;

  v_done := public.complete_sandbox_donation(v_intent.intent_id);
  if (v_done->>'status') <> 'paid' then
    raise exception 'ASSERT FAILED: sandbox complete should pay';
  end if;
end $$;

rollback;

\echo '✓ 0366_money_sandbox_flow.sql passed'
