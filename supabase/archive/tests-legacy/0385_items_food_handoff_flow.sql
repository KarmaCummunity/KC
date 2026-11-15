-- supabase/tests/0385_items_food_handoff_flow.sql | Reserve/confirm/handover + food claim

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
  v_owner uuid := '00000000-0000-0000-0000-000000380001';
  v_recv uuid := '00000000-0000-0000-0000-000000380002';
  v_kind uuid;
  v_listing uuid;
  v_handoff public.giving_handoffs;
begin
  perform pg_temp.mk_user(v_owner, 'giver380');
  perform pg_temp.mk_user(v_recv, 'recv380');

  select kind_id into v_kind from public.listing_kinds
   where world_slug = 'items' and slug = 'give_item' limit 1;

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('role', 'authenticated', true);

  v_listing := public.create_marketplace_listing(
    v_kind,
    'Test lamp',
    null,
    '{"item_condition":"Good","fulfillment_mode":"owner_approval"}'::jsonb,
    'give',
    null,
    null,
    2::smallint,
    'immediate',
    null,
    null,
    null,
    null
  );

  perform set_config('request.jwt.claim.sub', v_recv::text, true);
  v_handoff := public.reserve_item_giving(v_listing, 'pickup', null, null);

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  v_handoff := public.confirm_item_handoff(v_handoff.handoff_id);
  v_handoff := public.mark_giving_handed_over(v_handoff.handoff_id);

  if v_handoff.status <> 'handed_over' then
    raise exception 'ASSERT FAILED: expected handed_over';
  end if;
end $$;

rollback;
