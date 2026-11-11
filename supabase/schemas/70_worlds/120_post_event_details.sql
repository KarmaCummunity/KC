-- Worlds · post_event_details (the event behind a post of type `event`, G18)
--
-- An event is a post with a time window, an optional capacity and a registration policy.
-- A volunteering shift is an event too (design §12 Q3): an opportunity with several shifts
-- is several event posts, one per shift, because capacity, the waiting list, attendance
-- and expiry (D128) all belong to one time window. Extension point: the organizations
-- module restricts who may publish an event for an organization (posts.beneficiary_org_id).

create table public.post_event_details (
  post_id                uuid primary key references public.posts (id) on delete cascade,
  starts_at              timestamptz not null,
  ends_at                timestamptz not null,
  -- Places; null = unlimited. A full event puts new registrations on the waiting list.
  capacity               integer check (capacity between 1 and 5000),
  -- automatic: registered at once · manual: the organizer approves each registration ·
  -- verified_only: automatic, for members with a verified identity.
  registration_policy    text not null default 'automatic'
                           check (registration_policy in ('automatic', 'manual', 'verified_only')),
  -- Where the event takes place, as shown to everyone who can see the post.
  address_label          text check (char_length(btrim(address_label)) between 2 and 160),
  -- A volunteering shift: attendance adds the length of the event to the attendee's
  -- volunteering hours (spec 5.4, D32).
  counts_volunteer_hours boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint post_event_details_window_chk check (ends_at > starts_at)
);
comment on table public.post_event_details is
  'Time window, capacity and registration policy of an event post; volunteering shifts are events.';

-- Upcoming events by start: the events list of the time world and of an organization.
create index post_event_details_starts_idx on public.post_event_details (starts_at, post_id);

-- Moves the head of an event's waiting list into free places, while the event has not
-- started: to `confirmed`, or to `reserved` with the start as its deadline when the
-- organizer approves by hand. Called whenever a place may have become free.
create function kc_private.event_promote_waitlist(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.post_event_details;
begin
  select e.* into v_event from public.post_event_details e where e.post_id = p_post_id;
  if not found or v_event.starts_at <= now() then
    return;
  end if;
  -- Without a capacity nobody waits; the largest capacity stands in for "unlimited".
  perform kc_private.handoff_promote_waitlist(
    p_post_id, coalesce(v_event.capacity, 2147483647),
    case v_event.registration_policy when 'manual' then 'reserved' else 'confirmed' end);
  update public.post_handoffs h set confirm_by = v_event.starts_at
   where h.post_id = p_post_id and h.status = 'reserved' and h.confirm_by is null;
end;
$$;
comment on function kc_private.event_promote_waitlist(uuid) is
  'Promotes waiting registrations of an event that has not started into its free places.';

-- Rules of an event on every write:
--   window    a new event starts in the future and ends after it starts (event_time_invalid)
--   capacity  never below the places already taken (event_capacity_below_registrations)
--   post      its time window and its expiry at the end of the event (D128); the closure
--             rules of a post read the window (D131)
--   bookings  live registrations follow a moved window
create function kc_private.post_event_details_prepare()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform kc_private.post_for_details(new.post_id, 'event');
  if (tg_op = 'INSERT' and new.starts_at <= now()) or new.ends_at <= new.starts_at then
    raise exception 'event_time_invalid' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and new.capacity < kc_private.handoff_seats_taken(new.post_id) then
    raise exception 'event_capacity_below_registrations' using errcode = 'P0001';
  end if;
  update public.posts p
     set time_window = tstzrange(new.starts_at, new.ends_at), expires_at = new.ends_at
   where p.id = new.post_id;
  if tg_op = 'UPDATE' and (new.starts_at, new.ends_at) is distinct from (old.starts_at, old.ends_at) then
    update public.post_handoffs h
       set slot_starts_at = new.starts_at, slot_ends_at = new.ends_at,
           confirm_by = case when h.status = 'reserved' then new.starts_at end
     where h.post_id = new.post_id and h.status in ('waitlisted', 'reserved', 'confirmed');
  end if;
  return new;
end;
$$;
comment on function kc_private.post_event_details_prepare() is
  'BEFORE INSERT OR UPDATE on post_event_details: start, capacity, the post''s window and expiry, live registrations.';

create trigger post_event_details_prepare
  before insert or update on public.post_event_details
  for each row execute function kc_private.post_event_details_prepare();

-- More places, or no limit any more: the waiting list moves up.
create function kc_private.post_event_details_capacity_raised()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform kc_private.event_promote_waitlist(new.post_id);
  return null;
end;
$$;

create trigger post_event_details_capacity_raised
  after update of capacity on public.post_event_details
  for each row
  when (new.capacity is null or new.capacity > old.capacity)
  execute function kc_private.post_event_details_capacity_raised();

create trigger post_event_details_set_updated_at
  before update on public.post_event_details
  for each row execute function kc_private.set_updated_at();

alter table public.post_event_details enable row level security;
alter table public.post_event_details force row level security;

-- Visible exactly when the post is.
create policy post_event_details_select_visible on public.post_event_details
  for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_event_details.post_id));

-- The organizer edits the event while the post's content is editable.
create policy post_event_details_update_owner on public.post_event_details
  for update to authenticated
  using (exists (select 1 from public.posts p
                  where p.id = post_event_details.post_id and p.owner_id = (select auth.uid())
                    and p.status in ('draft', 'open', 'paused')))
  with check (exists (select 1 from public.posts p
                       where p.id = post_event_details.post_id and p.owner_id = (select auth.uid())));

grant select on public.post_event_details to authenticated;
grant update (starts_at, ends_at, capacity, registration_policy, address_label, counts_volunteer_hours)
  on public.post_event_details to authenticated;
