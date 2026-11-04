-- kc_test housing | Housing-world builders (G38). Compose the generic fixtures with the stay
-- shapes of migrations 0600–0603 (spec docs/spec/requirements/21_housing.md).

-- An active member who may act in housing: ID-verified (D30) and conduct accepted (R-Housing-2).
create function kc_test.create_housing_member(p_handle text)
returns uuid
language plpgsql
as $$
declare
  v_user uuid := kc_test.create_user(p_handle);
begin
  update public.users set verified_at = now(), verification_method = 'manual' where user_id = v_user;
  insert into public.housing_conduct_acceptances (user_id, version)
  values (v_user, public.housing_conduct_version());
  return v_user;
end;
$$;

-- A valid stay offer's details; p_overrides replaces top-level keys (FR-HOUSING-005, 011).
create function kc_test.housing_offer_details(p_overrides jsonb default '{}'::jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'place_type', 'private_room', 'capacity', 2, 'exclusive', false,
    'min_nights', 1, 'max_nights', 7,
    'check_in_from', '16:00', 'check_in_until', '22:00', 'check_out_by', '10:00',
    'guest_policy', 'any', 'children_ok', true, 'pets_ok', false, 'smoking', 'no',
    'availability', jsonb_build_object('mode', 'ongoing')
  ) || p_overrides;
$$;

-- Publishes a stay offer as p_host_id and returns its listing id.
create function kc_test.create_housing_offer(p_host_id uuid, p_overrides jsonb default '{}'::jsonb)
returns uuid
language sql
as $$
  select kc_test.create_listing(p_host_id, 'housing', 'host_offer', 'give',
                                'Room for travellers', kc_test.housing_offer_details(p_overrides), null);
$$;

-- Requests a stay of p_nights nights starting p_in_days from today (Israel) as p_guest_id.
create function kc_test.request_stay(
  p_guest_id uuid,
  p_listing_id uuid,
  p_in_days int default 3,
  p_nights int default 2,
  p_adults int default 1,
  p_minors int default 0
)
returns uuid
language plpgsql
as $$
declare
  v_row public.giving_handoffs;
begin
  perform kc_test.act_as(p_guest_id);
  v_row := public.request_housing_booking(
    p_listing_id, public.housing_today() + p_in_days, public.housing_today() + p_in_days + p_nights,
    p_adults, p_minors, 'Hi, I am walking the trail and need a bed', p_minors > 0);
  return v_row.handoff_id;
end;
$$;

-- Approves a waiting booking as its host.
create function kc_test.approve_stay(p_host_id uuid, p_handoff_id uuid)
returns void
language plpgsql
as $$
begin
  perform kc_test.act_as(p_host_id);
  perform public.decide_housing_booking(p_handoff_id, true, null);
end;
$$;

-- Moves a booking's check-in / check-out instants by p_shift (to test time windows without waiting).
create function kc_test.shift_stay(p_handoff_id uuid, p_shift interval)
returns void
language sql
as $$
  update public.giving_handoffs
     set slot_starts_at = slot_starts_at + p_shift, slot_ends_at = slot_ends_at + p_shift
   where handoff_id = p_handoff_id;
$$;
