-- kc_test rides | Rides-world builders (G38). Composes the generic listing fixture with
-- the ride_offer detail shape the native create form stores (0391 detail schema).

-- Fixed reference route used across rides tests: Tel Aviv → Jerusalem, as official city
-- places (D71, 0512). The canonical-places trigger fills label / lat / lng / city from
-- public.cities; the labels here only name the listing title.
create function kc_test.ride_route_tlv_jlm()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'origin_place_kind', 'city', 'origin_place_id', '5000', 'origin_label', 'Tel Aviv',
    'dest_place_kind', 'city', 'dest_place_id', '3000', 'dest_label', 'Jerusalem');
$$;

-- Publishes a ride offer departing p_departs_in from now with p_seats seats.
create function kc_test.create_ride_offer(
  p_driver_id uuid,
  p_seats int default 3,
  p_departs_in interval default interval '30 minutes',
  p_route jsonb default kc_test.ride_route_tlv_jlm()
)
returns uuid
language sql
as $$
  select kc_test.create_listing(
    p_driver_id, 'rides', 'ride_offer', 'give',
    format('%s to %s', p_route ->> 'origin_label', p_route ->> 'dest_label'),
    p_route || jsonb_build_object(
      'departs_at', kc_test.iso_in(p_departs_in),
      'seats_available', p_seats));
$$;

-- Books p_seats on a ride as p_passenger_id and returns the new handoff id.
create function kc_test.book_ride(p_passenger_id uuid, p_listing_id uuid, p_seats int default 1)
returns uuid
language plpgsql
as $$
declare
  v_handoff public.giving_handoffs;
begin
  perform kc_test.act_as(p_passenger_id);
  v_handoff := public.book_ride_seat(p_listing_id, p_seats);
  return v_handoff.handoff_id;
end;
$$;
