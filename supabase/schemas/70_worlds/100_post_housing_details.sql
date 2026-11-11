-- Worlds · post_housing_details (the stay offered by a post of type `housing_stay`)
--
-- The public, bookable side of a stay offer (FR-HOUSING-005, FR-HOUSING-011): what the
-- booking engine constrains — capacity per night, nights per booking, check-in times,
-- availability and blackout dates. Descriptive fields (amenities, accessibility, house
-- rules) stay in `posts.details`. The exact address is never here: it lives in
-- post_private_locations and reaches a guest only once their booking is approved (S53).

create table public.post_housing_details (
  post_id            uuid primary key references public.posts (id) on delete cascade,
  place_type         text not null check (place_type in (
                       'private_room', 'shared_room', 'couch', 'whole_unit', 'secondary_unit', 'tent_pitch')),
  -- Guests the place sleeps on one night, over all bookings of that night.
  capacity           smallint not null check (capacity between 1 and 20),
  -- One booking per night, whatever its size.
  exclusive          boolean not null default false,
  min_nights         smallint not null default 1,
  max_nights         smallint not null default 3,
  -- Israel local times. A check-in that ends after midnight is written as an earlier time
  -- than check_in_from (for example 16:00 to 01:00).
  check_in_from      time not null default '16:00',
  check_in_until     time not null default '22:00',
  check_out_by       time not null default '10:00',
  children_ok        boolean not null default false,
  pets_ok            boolean not null default false,
  -- Availability (FR-HOUSING-011): a window of dates, and / or only some weekdays (bit 0 =
  -- Sunday, the night that starts on that day). All null = ongoing.
  available_from     date,
  available_until    date,
  available_weekdays smallint check (available_weekdays between 1 and 127),
  -- Single nights the host blocked.
  blackout_dates     date[] not null default '{}' check (coalesce(array_length(blackout_dates, 1), 0) <= 60),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- Community stays last 1 to 30 nights (D120).
  constraint post_housing_details_nights_chk check (min_nights >= 1 and max_nights >= min_nights and max_nights <= 30),
  constraint post_housing_details_window_chk check (available_until >= available_from),
  -- A shared room or a couch is never exclusive (FR-HOUSING-005 AC2).
  constraint post_housing_details_shared_chk check (not (exclusive and place_type in ('shared_room', 'couch')))
);
comment on table public.post_housing_details is
  'Bookable terms of a stay offer: capacity, nights, check-in times, availability. The address is in post_private_locations.';

-- Stay search by date: offers whose window covers the dates asked for.
create index post_housing_details_window_idx on public.post_housing_details (available_from, available_until);

-- Rules of a stay offer on every write:
--   post      a stay offer (post_details_mismatch)
--   host      on creation, a verified identity where the world asks for one and the
--             current code of conduct (verification_required, housing_conduct_required)
--   capacity  never below the guests of an approved booking on any night ahead
--             (housing_active_booking_conflict, FR-HOUSING-035 AC3)
--   post      an offer with a closing date expires when that date ends (FR-HOUSING-011 AC5)
create function kc_private.post_housing_details_prepare()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post constant public.posts := kc_private.post_for_details(new.post_id, 'housing_stay');
begin
  if v_post.direction <> 'offer' then
    raise exception 'post_details_mismatch' using errcode = 'P0001';
  end if;
  if tg_op = 'INSERT' then
    perform kc_private.housing_assert_eligible(v_post.owner_id, v_post.world_slug);
  elsif (new.capacity < old.capacity or (new.exclusive and not old.exclusive))
        and exists (
          select 1 from public.post_handoffs h
            join public.handoff_booking_details d on d.handoff_id = h.id
           cross join lateral generate_series(d.check_in_date, d.check_out_date - 1, interval '1 day') n (night)
           where h.post_id = new.post_id and h.status = 'confirmed'
           group by n.night
          having sum(h.seats) > new.capacity or (new.exclusive and count(*) > 1)) then
    raise exception 'housing_active_booking_conflict' using errcode = 'P0001';
  end if;

  update public.posts p
     set expires_at = ((new.available_until + 1)::timestamp at time zone 'Asia/Jerusalem')
   where p.id = new.post_id;
  return new;
end;
$$;
comment on function kc_private.post_housing_details_prepare() is
  'BEFORE INSERT OR UPDATE on post_housing_details: stay offer, eligible host, capacity against bookings, post expiry.';

-- Raises unless the member may host or book in the housing world: a verified identity
-- where the world requires one (D30, D116) and the current code of conduct (S59).
create function kc_private.housing_assert_eligible(p_user_id uuid, p_world_slug text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform kc_private.world_assert_verified(p_user_id, p_world_slug);
  if not kc_private.world_consent_accepted(p_user_id, 'housing_conduct') then
    raise exception 'housing_conduct_required' using errcode = 'P0001';
  end if;
end;
$$;
comment on function kc_private.housing_assert_eligible(uuid, text) is
  'Raises verification_required or housing_conduct_required unless the member may host or book.';

create trigger post_housing_details_prepare
  before insert or update on public.post_housing_details
  for each row execute function kc_private.post_housing_details_prepare();

create trigger post_housing_details_set_updated_at
  before update on public.post_housing_details
  for each row execute function kc_private.set_updated_at();

alter table public.post_housing_details enable row level security;
alter table public.post_housing_details force row level security;

-- Visible exactly when the post is.
create policy post_housing_details_select_visible on public.post_housing_details
  for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_housing_details.post_id));

-- The host edits the terms while the post's content is editable.
create policy post_housing_details_update_owner on public.post_housing_details
  for update to authenticated
  using (exists (select 1 from public.posts p
                  where p.id = post_housing_details.post_id and p.owner_id = (select auth.uid())
                    and p.status in ('draft', 'open', 'paused')))
  with check (exists (select 1 from public.posts p
                       where p.id = post_housing_details.post_id and p.owner_id = (select auth.uid())));

grant select on public.post_housing_details to authenticated;
grant update (
  place_type, capacity, exclusive, min_nights, max_nights, check_in_from, check_in_until, check_out_by,
  children_ok, pets_ok, available_from, available_until, available_weekdays, blackout_dates
) on public.post_housing_details to authenticated;

-- Raises unless a party of p_party can stay every night from p_check_in to the night
-- before p_check_out: each night is open (inside the window, on an offered weekday, not
-- blacked out — housing_dates_unavailable) and has room beside the approved and completed
-- bookings of that night, p_exclude aside (housing_capacity_exceeded). The caller holds
-- the post row lock, so two approvals cannot both take the last bed.
create function kc_private.housing_assert_bookable(
  p_stay public.post_housing_details, p_check_in date, p_check_out date, p_party integer, p_exclude uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_night record;
begin
  for v_night in
    select n.night::date as night,
           (select coalesce(sum(h.seats), 0)
              from public.post_handoffs h
              join public.handoff_booking_details d on d.handoff_id = h.id
             where h.post_id = p_stay.post_id and h.status in ('confirmed', 'handed_over')
               and h.id is distinct from p_exclude
               and d.check_in_date <= n.night and d.check_out_date > n.night) as taken
      from generate_series(p_check_in, p_check_out - 1, interval '1 day') n (night)
  loop
    if v_night.night < p_stay.available_from or v_night.night > p_stay.available_until
       or (p_stay.available_weekdays & (1 << extract(dow from v_night.night)::integer)) = 0
       or v_night.night = any (p_stay.blackout_dates) then
      raise exception 'housing_dates_unavailable' using errcode = 'P0001';
    end if;
    if (p_stay.exclusive and v_night.taken > 0) or v_night.taken + p_party > p_stay.capacity then
      raise exception 'housing_capacity_exceeded' using errcode = 'P0001';
    end if;
  end loop;
end;
$$;
comment on function kc_private.housing_assert_bookable(public.post_housing_details, date, date, integer, uuid) is
  'Checks availability and per-night capacity of a stay for a party and a date range.';
