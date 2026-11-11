-- supabase/tests/0658_owner_complete_offer_with_user.sql
-- Owner assign names the recipient. A blocked member is refused. A full ride refuses another seat.

begin;

create temp table personas as
select kc_test.create_user('assign_owner') as owner,
       kc_test.create_user('assign_taker') as taker,
       kc_test.create_user('assign_blocked') as blocked,
       kc_test.create_user('assign_driver') as driver,
       kc_test.create_user('assign_rider') as rider,
       kc_test.create_user('assign_rider2') as rider2;

update public.users
   set account_status = 'active', verified_at = now()
 where user_id in (select owner from personas union select taker from personas
                   union select blocked from personas union select driver from personas
                   union select rider from personas union select rider2 from personas);

insert into public.blocks (blocker_id, blocked_id)
select owner, blocked from personas;

do $$
declare
  p personas;
  v_kind uuid;
  v_listing uuid;
  v_status text;
  v_handoff text;
  v_closed boolean;
begin
  select * into p from personas;
  perform kc_test.act_as(p.owner);
  select kind_id into v_kind from public.listing_kinds
   where world_slug = 'animals' and slug = 'adoption_offer';
  v_listing := public.create_marketplace_listing(
    p_kind_id => v_kind,
    p_title => 'Kitten to a named home',
    p_details => '{"species":"cat"}'::jsonb);

  perform kc_test.act_as(p.owner);
  begin
    perform public.owner_complete_offer_with_user(v_listing, p.blocked, 'assign');
    raise exception 'ASSERT FAILED: a blocked member was assigned';
  exception when others then
    if sqlerrm not like '%closure_recipient_not_in_chat%' and sqlerrm not like 'ASSERT FAILED%' then
      raise;
    end if;
    if sqlerrm like 'ASSERT FAILED%' then raise; end if;
  end;

  v_closed := (public.owner_complete_offer_with_user(v_listing, p.taker, 'assign')->>'closed')::boolean;
  if v_closed is not true then
    raise exception 'ASSERT FAILED: animals assign left the offer open';
  end if;
  select h.status into v_handoff
    from public.post_handoffs h
    join public.posts po on po.post_id = h.post_id
   where po.listing_id = v_listing and h.recipient_id = p.taker;
  if v_handoff is distinct from 'handed_over' then
    raise exception 'ASSERT FAILED: animals handoff is %', v_handoff;
  end if;
  select po.status into v_status from public.posts po where po.listing_id = v_listing;
  if v_status is distinct from 'closed_delivered' then
    raise exception 'ASSERT FAILED: animals post status %', v_status;
  end if;
end $$;

do $$
declare
  p personas;
  v_listing uuid;
  v_handoff text;
  v_closed boolean;
begin
  select * into p from personas;
  perform kc_test.act_as(p.driver);
  v_listing := public.create_marketplace_listing(
    p_kind_id => kc_test.listing_kind_id('rides', 'ride_offer'),
    p_title => 'One seat to Jerusalem',
    p_summary => 'leaving from the central station',
    p_details => kc_test.ride_route_tlv_jlm() || jsonb_build_object(
      'departs_at', kc_test.iso_in(interval '3 hours'), 'seats_available', 1),
    p_city_id => 'tel-aviv');

  perform kc_test.act_as(p.driver);
  v_closed := (public.owner_complete_offer_with_user(v_listing, p.rider, 'assign')->>'closed')::boolean;
  if v_closed is true then
    raise exception 'ASSERT FAILED: a future ride closed on the first assign';
  end if;
  select h.status into v_handoff
    from public.post_handoffs h
    join public.listings l on l.legacy_post_id = h.post_id
   where l.listing_id = v_listing and h.recipient_id = p.rider;
  if v_handoff is distinct from 'confirmed' then
    raise exception 'ASSERT FAILED: ride assign status %', v_handoff;
  end if;

  begin
    perform public.owner_complete_offer_with_user(v_listing, p.rider2, 'assign');
    raise exception 'ASSERT FAILED: a full ride accepted another passenger';
  exception when others then
    if sqlerrm not like '%seats_exhausted%' and sqlerrm not like 'ASSERT FAILED%' then
      raise;
    end if;
    if sqlerrm like 'ASSERT FAILED%' then raise; end if;
  end;
end $$;

rollback;
