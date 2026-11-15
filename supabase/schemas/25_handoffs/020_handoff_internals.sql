-- Handoffs · shared internals
--
-- Building blocks of every handoff RPC, in this module and in the modules that add the
-- ride, housing, event and knowledge flows on top of it. None is callable from a device.

-- May the caller manage (publish, pause, close, reopen, delete) this post? Today: the caller
-- owns it. This is the one place the organizations module (admins of the organization the
-- post belongs to) and the moderation module (super admin) extend (design §12.1).
create function kc_private.can_manage_post(p_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.posts p
                  where p.id = p_post_id and p.owner_id = (select auth.uid()));
$$;
comment on function kc_private.can_manage_post(uuid) is
  'Authorization of every post management action: the caller owns the post.';

-- Locks a post the caller may manage and returns it. One error for "no such post" and
-- "not yours", so the existence of a post the caller cannot see is not revealed.
create function kc_private.post_lock_managed(p_post_id uuid)
returns public.posts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.posts;
begin
  perform kc_private.require_active_caller();
  if not kc_private.can_manage_post(p_post_id) then
    raise exception 'post_not_found' using errcode = 'P0001';
  end if;
  select p.* into strict v_post from public.posts p where p.id = p_post_id for update;
  return v_post;
end;
$$;
comment on function kc_private.post_lock_managed(uuid) is
  'Row-locks a post for a management action; raises post_not_found unless the caller may manage it.';

-- Moves a post to a status in the given role, then restores the role that was in force, so
-- a move made in the middle of another move does not change who the outer one acts as.
create function kc_private.post_move(p_post_id uuid, p_to text, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outer_role constant text := coalesce(current_setting('kc.fsm_role', true), '');
begin
  perform set_config('kc.fsm_role', p_role, true);
  update public.posts p set status = p_to where p.id = p_post_id;
  perform set_config('kc.fsm_role', v_outer_role, true);
end;
$$;
comment on function kc_private.post_move(uuid, text, text) is 'Moves a post along its machine in the given role.';

-- Moves a handoff to a status in the given role and returns the row.
create function kc_private.handoff_move(
  p_handoff_id uuid,
  p_to text,
  p_role text,
  p_cancel_reason text default null
)
returns public.post_handoffs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outer_role constant text := coalesce(current_setting('kc.fsm_role', true), '');
  v_handoff public.post_handoffs;
begin
  perform set_config('kc.fsm_role', p_role, true);
  update public.post_handoffs h
     set status = p_to, cancel_reason = p_cancel_reason
   where h.id = p_handoff_id
  returning h.* into v_handoff;
  perform set_config('kc.fsm_role', v_outer_role, true);
  return v_handoff;
end;
$$;
comment on function kc_private.handoff_move(uuid, text, text, text) is
  'Moves a handoff along its machine in the given role.';

-- Locks a handoff for a move and returns it. The post row is locked first: every writer
-- takes the two locks in this order, so a handoff move and a post closure never deadlock.
create function kc_private.handoff_lock(p_handoff_id uuid)
returns public.post_handoffs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_handoff public.post_handoffs;
begin
  perform 1 from public.posts p
    where p.id = (select h.post_id from public.post_handoffs h where h.id = p_handoff_id)
      for update;
  select h.* into v_handoff from public.post_handoffs h where h.id = p_handoff_id for update;
  if not found then
    raise exception 'handoff_not_found' using errcode = 'P0001';
  end if;
  return v_handoff;
end;
$$;
comment on function kc_private.handoff_lock(uuid) is 'Row-locks a handoff and its post, post first.';

-- Seats of a post that are held or were used: reserved, confirmed and handed over.
create function kc_private.handoff_seats_taken(p_post_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(h.seats), 0)::integer
    from public.post_handoffs h
   where h.post_id = p_post_id and h.status in ('reserved', 'confirmed', 'handed_over');
$$;
comment on function kc_private.handoff_seats_taken(uuid) is 'Seats of a post held by live or completed handoffs.';

-- Does a live handoff stand in the way of pausing or closing the post (D104)? Event
-- registrations never do: they are cancelled with the event instead (D131).
create function kc_private.post_has_active_handoff(p_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.post_handoffs h
                  where h.post_id = p_post_id and h.status in ('reserved', 'confirmed')
                    and h.machine_id <> 'event_registration');
$$;
comment on function kc_private.post_has_active_handoff(uuid) is
  'A reserved or confirmed handoff exists on the post, event registrations aside.';

-- Could this member open the post as any other member would: it is open and not past its
-- expiry, its audience includes them, both accounts are active and no block stands between
-- them. The same rule as the read policy on posts, for a member other than the caller.
create function kc_private.post_open_to_member(p_post public.posts, p_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_post.status = 'open'
     and (p_post.expires_at is null or p_post.expires_at > now())
     and (p_post.visibility = 'Public'
          or (p_post.visibility = 'FollowersOnly'
              and exists (select 1 from public.follows f
                           where f.follower_id = p_member_id and f.followed_id = p_post.owner_id)))
     and (select count(*) from public.users u
           where u.id in (p_member_id, p_post.owner_id) and u.is_active) = 2
     and not kc_access.is_blocked_between(p_member_id, p_post.owner_id);
$$;
comment on function kc_private.post_open_to_member(public.posts, uuid) is
  'The post is open and visible to the given member, and neither side is blocked or inactive.';

-- Creates a handoff on an open post for a member, in the given starting status.
--   own_listing            the member owns the post
--   listing_not_available  the post is not open to that member (closed, hidden, expired,
--                          outside its audience, or a block between the two)
--   item_already_reserved  the member already holds a live handoff on the post
--   p_full_error           the seats asked for do not fit under p_capacity (null = no limit);
--                          a `waitlisted` row takes no seat and is never refused for capacity
-- The post row lock serializes competing reservations, so capacity cannot be exceeded.
create function kc_private.handoff_open(
  p_post_id uuid,
  p_recipient_id uuid,
  p_status text,
  p_capacity integer,
  p_seats integer default 1,
  p_fields jsonb default '{}'::jsonb,
  p_full_error text default 'seats_exhausted'
)
returns public.post_handoffs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.posts;
  v_handoff public.post_handoffs;
begin
  perform kc_private.rate_limit_enforce('handoff_request', p_recipient_id);  -- 95_platform
  select p.* into v_post from public.posts p where p.id = p_post_id for update;
  if found and v_post.owner_id = p_recipient_id then
    raise exception 'own_listing' using errcode = 'P0001';
  end if;
  if not found or not kc_private.post_open_to_member(v_post, p_recipient_id) then
    raise exception 'listing_not_available' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.post_handoffs h
              where h.post_id = p_post_id and h.recipient_id = p_recipient_id
                and h.status in ('waitlisted', 'reserved', 'confirmed')) then
    raise exception 'item_already_reserved' using errcode = 'P0001';
  end if;
  if p_status <> 'waitlisted'
     and kc_private.handoff_seats_taken(p_post_id) + p_seats > p_capacity then
    raise exception '%', p_full_error using errcode = 'P0001';
  end if;

  -- p_fields carries the optional columns by name: pickup_mode, pickup_window_start,
  -- pickup_window_end, slot_starts_at, slot_ends_at, confirm_by, requested_meeting_point.
  insert into public.post_handoffs (
    post_id, recipient_id, status, seats, pickup_mode, pickup_window_start, pickup_window_end,
    slot_starts_at, slot_ends_at, confirm_by, requested_meeting_point)
  values (
    p_post_id, p_recipient_id, p_status, p_seats,
    coalesce(p_fields ->> 'pickup_mode', 'pickup'),
    (p_fields ->> 'pickup_window_start')::timestamptz, (p_fields ->> 'pickup_window_end')::timestamptz,
    (p_fields ->> 'slot_starts_at')::timestamptz, (p_fields ->> 'slot_ends_at')::timestamptz,
    (p_fields ->> 'confirm_by')::timestamptz, p_fields -> 'requested_meeting_point')
  returning * into v_handoff;
  return v_handoff;
end;
$$;
comment on function kc_private.handoff_open(uuid, uuid, text, integer, integer, jsonb, text) is
  'Creates a handoff on an open post under the post row lock, enforcing visibility, one live handoff per member and capacity.';

-- Promotes the head of an event's waiting list into seats that became free: the oldest
-- waiting registrations move to p_to_status (`confirmed`, or `reserved` when the organizer
-- approves by hand) while they fit under p_capacity. Called by the events module, which
-- knows the capacity and the registration policy, whenever a seat is freed.
create function kc_private.handoff_promote_waitlist(p_post_id uuid, p_capacity integer, p_to_status text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next public.post_handoffs;
  v_promoted integer := 0;
begin
  perform 1 from public.posts p where p.id = p_post_id for update;
  for v_next in
    select h.* from public.post_handoffs h
     where h.post_id = p_post_id and h.status = 'waitlisted'
     order by h.created_at, h.id
  loop
    exit when kc_private.handoff_seats_taken(p_post_id) + v_next.seats > p_capacity;
    perform kc_private.handoff_move(v_next.id, p_to_status, 'system');
    v_promoted := v_promoted + 1;
  end loop;
  return v_promoted;
end;
$$;
comment on function kc_private.handoff_promote_waitlist(uuid, integer, text) is
  'Moves waiting event registrations into free seats, oldest first; returns how many were promoted.';
