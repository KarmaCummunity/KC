-- 0517_ride_listing_safety | The legacy rides' safety rules on the one rides flow
-- (docs/spec/05_giving_worlds.md §5.3 step 6 and "Rules", D70; gap G44).
--
--   1. Cost-sharing caps: no profit — a ride's cost share is at most ₪20 inside one city and
--      ₪70 between cities. Enforced on every native ride write (`ride_cost_share_cap_exceeded`).
--   2. Emergency button during an active ride: the driver or an approved passenger raises an
--      emergency from 1 hour before departure until 2 hours after the estimated end (or 8 hours
--      after departure). One per person per ride per 5 minutes. Every other participant and the
--      super admins get a critical push that opens the ride.

begin;

-- ── 1. Cost-sharing caps ─────────────────────────────────────────────────────
-- The cap for a ride's route: urban when both ends are in the same city, else intercity.
create or replace function public.ride_cost_share_cap(p_details jsonb)
returns numeric
language sql
immutable
as $$
  select case
    when p_details->>'origin_city_id' is not null
         and p_details->>'origin_city_id' = p_details->>'dest_city_id' then 20
    else 70
  end::numeric;
$$;

comment on function public.ride_cost_share_cap(jsonb) is
  'Cost-share cap in ILS: 20 inside one city, 70 between cities (spec 05 §5.3 Rules).';

create or replace function public.listings_ride_cost_cap()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_cost numeric;
begin
  if new.world_slug <> 'rides' or new.origin <> 'native' then return new; end if;
  begin
    v_cost := nullif(new.details->>'cost_share_ils', '')::numeric;
  exception
    when invalid_text_representation then
      raise exception 'ride_cost_share_cap_exceeded' using errcode = '23514';
  end;
  if v_cost is not null and (v_cost < 0 or v_cost > public.ride_cost_share_cap(new.details)) then
    raise exception 'ride_cost_share_cap_exceeded' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- BEFORE triggers fire in name order: "route" sorts after "places", so this check sees the
-- city ids listings_ride_places_canonical resolved from the catalogs, never the client's.
drop trigger if exists listings_ride_route_cost_cap on public.listings;
create trigger listings_ride_route_cost_cap
  before insert or update of details on public.listings
  for each row execute function public.listings_ride_cost_cap();

-- ── 2. Emergency during an active ride ──────────────────────────────────────
create table if not exists public.ride_listing_emergencies (
  event_id     uuid primary key default gen_random_uuid(),
  listing_id   uuid not null references public.listings(listing_id) on delete cascade,
  triggered_by uuid not null references public.users(user_id) on delete cascade,
  triggered_at timestamptz not null default now(),
  note         text check (note is null or char_length(note) <= 500),
  resolved_at  timestamptz,
  resolved_by  uuid references public.users(user_id) on delete set null
);

create index if not exists ride_listing_emergencies_listing_idx
  on public.ride_listing_emergencies (listing_id, triggered_at desc);

alter table public.ride_listing_emergencies enable row level security;

-- Seen by whoever raised it, the ride's driver and super admins; written only by the RPC.
drop policy if exists ride_listing_emergencies_select on public.ride_listing_emergencies;
create policy ride_listing_emergencies_select
  on public.ride_listing_emergencies for select
  to authenticated
  using (
    triggered_by = auth.uid()
    or exists (select 1 from public.listings l
                where l.listing_id = ride_listing_emergencies.listing_id and l.owner_id = auth.uid())
    or public.has_admin_role(auth.uid(), 'super_admin')
  );

-- The ride's participants: its driver and every approved or completed passenger.
create or replace function public.ride_listing_participants(p_listing_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select owner_id from public.listings where listing_id = p_listing_id
  union
  select recipient_id from public.giving_handoffs
   where listing_id = p_listing_id and world_slug = 'rides' and status in ('confirmed', 'handed_over');
$$;

create or replace function public.ride_listing_emergency(p_listing_id uuid, p_note text default null)
returns public.ride_listing_emergencies
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_l public.listings;
  v_departs timestamptz;
  v_until timestamptz;
  v_row public.ride_listing_emergencies;
  v_to uuid;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  select * into v_l from public.listings where listing_id = p_listing_id and world_slug = 'rides';
  if not found then raise exception 'listing_not_available' using errcode = 'P0002'; end if;
  if v_uid not in (select public.ride_listing_participants(p_listing_id)) then
    raise exception 'not_participant' using errcode = '42501';
  end if;

  -- Active window: 1 hour before departure until 2 hours after the estimated end.
  v_departs := nullif(v_l.details->>'departs_at', '')::timestamptz;
  v_until := coalesce(nullif(v_l.details->>'arrives_at', '')::timestamptz, v_departs + interval '6 hours')
             + interval '2 hours';
  if v_departs is null or now() < v_departs - interval '1 hour' or now() > v_until then
    raise exception 'ride_not_active' using errcode = '23514';
  end if;

  if exists (select 1 from public.ride_listing_emergencies
              where listing_id = p_listing_id and triggered_by = v_uid
                and triggered_at > now() - interval '5 minutes') then
    raise exception 'emergency_throttled' using errcode = '23514';
  end if;

  insert into public.ride_listing_emergencies (listing_id, triggered_by, note)
  values (p_listing_id, v_uid, nullif(btrim(p_note), ''))
  returning * into v_row;

  -- Everyone else on the ride and every super admin hears it at once (critical).
  for v_to in
    select p from public.ride_listing_participants(p_listing_id) p where p <> v_uid
    union
    select u.user_id from public.users u where public.has_admin_role(u.user_id, 'super_admin')
  loop
    perform public.enqueue_notification(
      v_to, 'critical', 'ride_listing_emergency',
      'notifications.rideEmergencyTitle', 'notifications.rideEmergencyBody',
      jsonb_build_object('rideTitle', coalesce(v_l.title, '')),
      jsonb_build_object('route', '/(tabs)/donations/marketplace/[listingId]',
                         'params', jsonb_build_object('listingId', p_listing_id::text)),
      'ride_listing_emergency:' || v_row.event_id::text || ':' || v_to::text,
      true);
  end loop;
  return v_row;
end;
$$;

comment on function public.ride_listing_emergency(uuid, text) is
  'Emergency during an active ride (driver or approved passenger); alerts the others and super admins.';

-- ── Grants ───────────────────────────────────────────────────────────────────
grant select on public.ride_listing_emergencies to authenticated;
revoke all on function public.ride_listing_participants(uuid) from public, anon, authenticated;
revoke all on function public.ride_listing_emergency(uuid, text) from public;
revoke all on function public.listings_ride_cost_cap() from public, anon, authenticated;
grant execute on function public.ride_listing_emergency(uuid, text) to authenticated;

commit;
