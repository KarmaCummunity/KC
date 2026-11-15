-- Handoffs · post_handoffs (the closing stage of every post, D19)
--
-- One row per member who takes part in closing a post: the member who reserved an item, the
-- passenger of a ride, the guest of a stay, the attendee of an event, the learner of a
-- session. It replaces the former `recipients` table as well: the member an owner names when
-- closing a post is a handoff that is created already handed over.
--
-- Four machines share the table; the post type picks the one that rules a row:
--   giving_handoff      every post type without its own machine (items, food, animals, knowledge)
--   ride_booking        post type `ride`
--   housing_booking     post type `housing_stay`
--   event_registration  post type `event`
-- Each edge names who may take it: the post `owner`, the `recipient` (the other member), or
-- `system` (sweeps and the consequences of a post leaving the air).

-- The machine that rules the handoffs of a post of this type.
create function kc_private.handoff_machine_of(p_post_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_post_type
    when 'ride' then 'ride_booking'
    when 'housing_stay' then 'housing_booking'
    when 'event' then 'event_registration'
    else 'giving_handoff'
  end;
$$;
comment on function kc_private.handoff_machine_of(text) is
  'Lifecycle machine of the handoffs of a post, by post type.';

insert into kc_private.fsm_state (machine_id, status)
select m.machine_id, s.status
  from (values
    ('giving_handoff', array['reserved', 'confirmed', 'handed_over', 'cancelled', 'no_show']),
    ('ride_booking', array['reserved', 'confirmed', 'handed_over', 'cancelled']),
    ('housing_booking', array['reserved', 'confirmed', 'handed_over', 'cancelled', 'no_show']),
    ('event_registration',
     array['waitlisted', 'reserved', 'confirmed', 'handed_over', 'cancelled', 'no_show'])
  ) as m (machine_id, statuses), unnest(m.statuses) as s (status);

insert into kc_private.fsm_edge (machine_id, from_status, to_status, role)
select e.machine_id, e.from_status, e.to_status, r.role
  from (values
    -- Items, food, animals, knowledge: request → approval → handed over.
    ('giving_handoff', 'reserved', 'confirmed', array['owner']),
    -- The owner names a member who was still waiting as the one who received it.
    ('giving_handoff', 'reserved', 'handed_over', array['owner']),
    ('giving_handoff', 'reserved', 'cancelled', array['owner', 'recipient', 'system']),
    ('giving_handoff', 'confirmed', 'handed_over', array['owner', 'recipient']),
    ('giving_handoff', 'confirmed', 'cancelled', array['owner', 'recipient', 'system']),
    ('giving_handoff', 'confirmed', 'no_show', array['system']),
    -- The delivery is taken back: the owner reopens the post (FR-CLOSURE-005) or the
    -- recipient removes their own mark (FR-CLOSURE-007).
    ('giving_handoff', 'handed_over', 'cancelled', array['owner', 'recipient']),
    -- Rides: the driver approves, either side completes the trip, the driver may reinstate a
    -- booking they declined or cancelled.
    ('ride_booking', 'reserved', 'confirmed', array['owner']),
    ('ride_booking', 'reserved', 'handed_over', array['owner']),
    ('ride_booking', 'reserved', 'cancelled', array['owner', 'recipient', 'system']),
    ('ride_booking', 'confirmed', 'handed_over', array['owner', 'recipient']),
    ('ride_booking', 'confirmed', 'cancelled', array['owner', 'recipient', 'system']),
    ('ride_booking', 'cancelled', 'reserved', array['owner']),
    ('ride_booking', 'cancelled', 'confirmed', array['owner']),
    -- Housing: the host decides, completes the stay or reports a guest who did not arrive.
    ('housing_booking', 'reserved', 'confirmed', array['owner']),
    ('housing_booking', 'reserved', 'cancelled', array['owner', 'recipient', 'system']),
    ('housing_booking', 'confirmed', 'handed_over', array['owner']),
    ('housing_booking', 'confirmed', 'cancelled', array['owner', 'recipient', 'system']),
    ('housing_booking', 'confirmed', 'no_show', array['owner']),
    -- Events: a freed seat promotes the waiting list; the organizer marks attendance and
    -- may correct a no-show.
    ('event_registration', 'waitlisted', 'reserved', array['system']),
    ('event_registration', 'waitlisted', 'confirmed', array['system']),
    ('event_registration', 'waitlisted', 'cancelled', array['owner', 'recipient', 'system']),
    ('event_registration', 'reserved', 'confirmed', array['owner', 'system']),
    ('event_registration', 'reserved', 'cancelled', array['owner', 'recipient', 'system']),
    ('event_registration', 'confirmed', 'handed_over', array['owner']),
    ('event_registration', 'confirmed', 'cancelled', array['owner', 'recipient', 'system']),
    ('event_registration', 'confirmed', 'no_show', array['owner']),
    ('event_registration', 'no_show', 'handed_over', array['owner'])
  ) as e (machine_id, from_status, to_status, roles), unnest(e.roles) as r (role);

create table public.post_handoffs (
  id                      uuid primary key default gen_random_uuid(),
  post_id                 uuid not null references public.posts (id) on delete cascade,
  -- Owner of the post, copied on insert so that access is decided on this row alone.
  owner_id                uuid not null references public.users (id) on delete cascade,
  -- The other member: who reserves, books, registers, or is named by the owner.
  recipient_id            uuid not null references public.users (id) on delete cascade,
  -- Machine that rules `status`, derived from the post type on insert.
  machine_id              text not null,
  status                  text not null default 'reserved',
  -- Why a cancelled handoff ended. Present exactly while the status is `cancelled`.
  cancel_reason           text check (cancel_reason in (
                            'declined', 'expired', 'owner_cancelled', 'recipient_cancelled',
                            'passenger_cancelled', 'driver_cancelled', 'guest_cancelled', 'host_cancelled',
                            'not_completed', 'superseded', 'system', 'post_deleted', 'reopened', 'unmarked')),
  pickup_mode             text not null default 'pickup' check (pickup_mode in ('pickup', 'delivery')),
  -- When the item is collected; a confirmed pickup long past its window is a no-show.
  pickup_window_start     timestamptz,
  pickup_window_end       timestamptz,
  -- The booked time: a lesson slot, a stay from check-in to check-out, an event.
  slot_starts_at          timestamptz,
  slot_ends_at            timestamptz,
  -- Seats of a ride, guests of a stay; 1 everywhere else.
  seats                   integer not null default 1 check (seats between 1 and 8),
  -- A reservation the owner has not answered by this time lapses.
  confirm_by              timestamptz,
  -- Meeting place a passenger asked for when booking (FR-RIDE-030).
  requested_meeting_point jsonb check (
                            jsonb_typeof(requested_meeting_point) = 'object'
                            and requested_meeting_point ?& array['kind', 'id', 'label']),
  created_at              timestamptz not null default now(),
  confirmed_at            timestamptz,
  handed_over_at          timestamptz,
  cancelled_at            timestamptz,
  no_show_at              timestamptz,
  updated_at              timestamptz not null default now(),
  constraint post_handoffs_distinct_members_chk check (owner_id <> recipient_id),
  constraint post_handoffs_pickup_window_chk check (pickup_window_end >= pickup_window_start),
  constraint post_handoffs_slot_chk check (slot_ends_at > slot_starts_at),
  constraint post_handoffs_cancel_reason_chk check ((status = 'cancelled') = (cancel_reason is not null))
);
comment on table public.post_handoffs is
  'Closing stage of every post: who takes it, when, how many seats, and how it ended. Written only by server code.';

-- A member holds at most one live handoff on a post.
create unique index post_handoffs_live_member_key on public.post_handoffs (post_id, recipient_id)
  where status in ('waitlisted', 'reserved', 'confirmed');
-- Seat arithmetic, the "has a live handoff" guards and the roster of a post; covers post_id.
create index post_handoffs_post_status_idx on public.post_handoffs (post_id, status);
-- "My requests and bookings", newest first; covers recipient_id.
create index post_handoffs_recipient_recent_idx on public.post_handoffs (recipient_id, created_at desc, id desc);
-- Requests waiting on the owner and their history, newest first; covers owner_id.
create index post_handoffs_owner_recent_idx on public.post_handoffs (owner_id, created_at desc, id desc);
-- Expiry sweep: unanswered reservations past their deadline.
create index post_handoffs_confirm_due_idx on public.post_handoffs (confirm_by) where status = 'reserved';
-- No-show sweep: confirmed pickups past their window.
create index post_handoffs_pickup_due_idx on public.post_handoffs (pickup_window_end)
  where status = 'confirmed' and machine_id = 'giving_handoff';

-- Guards every write of a handoff.
--   insert   copies the owner and the machine from the post; the status must be a state of
--            that machine
--   status   the move must be an edge of the row's machine for the role stated in the
--            transaction-local setting `kc.fsm_role`
-- and stamps the time of each state, so no writer can forget it.
create function kc_private.post_handoffs_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from constant text := case tg_op when 'UPDATE' then old.status end;
begin
  if tg_op = 'INSERT' then
    select p.owner_id, kc_private.handoff_machine_of(p.post_type)
      into strict new.owner_id, new.machine_id
      from public.posts p where p.id = new.post_id;
    perform kc_private.fsm_assert_transition(new.machine_id, new.status, new.status);
  elsif new.status is distinct from old.status then
    perform kc_private.fsm_assert_transition(
      new.machine_id, old.status, new.status, nullif(current_setting('kc.fsm_role', true), ''));
  else
    return new;
  end if;

  -- A booking brought back from `cancelled`, or a corrected no-show, forgets how it ended.
  if new.status <> 'cancelled' then
    new.cancelled_at := null;
    new.cancel_reason := null;
  end if;
  if new.status <> 'no_show' then
    new.no_show_at := null;
  end if;
  case new.status
    when 'confirmed' then new.confirmed_at := now();
    when 'handed_over' then new.handed_over_at := now();
    when 'cancelled' then new.cancelled_at := now(); new.handed_over_at := null;
    when 'no_show' then new.no_show_at := now();
    else null;
  end case;
  if v_from = 'cancelled' and new.status = 'reserved' then
    new.confirmed_at := null;
  end if;
  return new;
end;
$$;
comment on function kc_private.post_handoffs_guard() is
  'BEFORE INSERT OR UPDATE OF status on post_handoffs: owner and machine from the post, legal move for the acting role, state timestamps.';

create trigger post_handoffs_guard
  before insert or update of status on public.post_handoffs
  for each row execute function kc_private.post_handoffs_guard();

create trigger post_handoffs_set_updated_at
  before update on public.post_handoffs
  for each row execute function kc_private.set_updated_at();

alter table public.post_handoffs enable row level security;
alter table public.post_handoffs force row level security;

-- Only the two members of a handoff ever see it. No write policy and no write grant exist:
-- every change goes through an RPC.
create policy post_handoffs_select_party on public.post_handoffs
  for select to authenticated
  using (owner_id = (select auth.uid()) or recipient_id = (select auth.uid()));

grant select on public.post_handoffs to authenticated;

-- The other member of a handoff reads the post whatever its audience (FR-POST-017): a
-- follower-only or private post stays readable to the member who reserved or received it.
-- Status and owner visibility are the same conditions as for every other reader.
create policy posts_select_handoff_party on public.posts
  for select to authenticated
  using (
    status in ('open', 'closed_delivered')
    and exists (select 1 from public.post_handoffs h
                 where h.post_id = posts.id and h.recipient_id = (select auth.uid())
                   and h.status <> 'cancelled')
    and exists (select 1 from public.users u where u.id = posts.owner_id));
