-- flows/rides_listing_chat.sql | #1412: messaging the publisher of a ride (docs/spec §5.3,
-- FR-CHAT AC8). A driver answering a ride request, or a passenger asking about a ride offer,
-- opens a chat anchored on the listing through `start_listing_chat` (0464), for a ride from
-- the native flow and for one synced from the legacy `ride_listings` table. The publisher
-- cannot message their own ride, and a ride the viewer cannot see is refused with `forbidden`.

begin;

create temp table personas as
select kc_test.create_user('rlc_requester') as requester,
       kc_test.create_user('rlc_driver')    as driver,
       kc_test.create_user('rlc_passenger') as passenger;

-- 1) A driver messages the author of a native ride request; the chat carries the listing and
--    the opening message.
do $$
declare
  p personas;
  v_request uuid;
  v_chat uuid;
begin
  select * into p from personas;
  v_request := kc_test.create_listing(
    p.requester, 'rides', 'ride_request', 'request', 'Tel Aviv to Jerusalem',
    kc_test.ride_route_tlv_jlm() || jsonb_build_object('departs_at', kc_test.iso_in(interval '2 hours'), 'passengers', 2));

  perform kc_test.act_as(p.driver);
  v_chat := public.start_listing_chat(v_request, 'I can take you');

  perform kc_test.assert_eq(
    (select anchor_listing_id from public.chats where chat_id = v_chat), v_request,
    'the chat is anchored on the ride request');
  perform kc_test.assert_row_count(
    format('select 1 from public.messages where chat_id = %L and sender_id = %L and body = %L',
           v_chat, p.driver, 'I can take you'),
    1, 'the opening message is in the chat');

  -- The publisher of the request cannot message their own listing.
  perform kc_test.act_as(p.requester);
  perform kc_test.assert_raises(
    format('select public.start_listing_chat(%L)', v_request),
    'cannot_chat_self', 'the requester cannot message their own ride request');
end $$;

-- 2) A passenger messages the driver of a ride offer synced from the legacy rides table.
do $$
declare
  p personas;
  v_ride uuid;
  v_listing uuid;
  v_chat uuid;
begin
  select * into p from personas;
  if not exists (select 1 from pg_trigger where tgname = 'ride_listings_sync_listing') then
    return;
  end if;
  -- A legacy ride offer needs the driver's declarations (0180).
  insert into public.driver_declarations (user_id, license_declared, insurance_declared, no_profit_acknowledged)
  values (p.driver, true, true, true);
  insert into public.ride_listings (owner_id, mode, origin_city_id, dest_city_id, departs_at, title,
                                    origin_street, dest_street, seats_available)
  values (p.driver, 'offer', '5000', '3000', now() + interval '3 hours', 'Legacy ride',
          'Herzl', 'Jaffa', 2)
  returning ride_id into v_ride;
  select listing_id into v_listing from public.listings where legacy_ride_id = v_ride;
  perform kc_test.assert_true(v_listing is not null, 'the legacy ride is synced into listings');

  perform kc_test.act_as(p.passenger);
  v_chat := public.start_listing_chat(v_listing, 'Is there a seat?');
  perform kc_test.assert_eq(
    (select anchor_listing_id from public.chats where chat_id = v_chat), v_listing,
    'the chat is anchored on the synced ride listing');

  -- Once the legacy ride is closed, it is no longer visible to the passenger.
  update public.ride_listings set status = 'cancelled' where ride_id = v_ride;
  perform kc_test.assert_raises(
    format('select public.start_listing_chat(%L)', v_listing),
    'forbidden', 'a ride the viewer can no longer see is refused');
end $$;

rollback;

\echo '✓ flows/rides_listing_chat.sql passed'
