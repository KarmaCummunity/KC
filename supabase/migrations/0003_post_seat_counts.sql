-- Worlds · seats of events and rides as their readers see them (G18, spec 5.3 and 5.4)
--
-- An event shift shows its open places and a ride occurrence its free seats to everyone
-- who can see the post. The handoffs behind those numbers are visible to their two members
-- only, so the counts are taken by a definer helper and released per post through a
-- function that runs with the caller's rights: row security on `posts` decides which posts
-- come back, exactly as for the post itself.

-- Places held on a post and members waiting for one. Held places are the seats of live or
-- completed handoffs (the same sum as kc_private.handoff_seats_taken); the waiting list is
-- counted in registrations. Reads post_handoffs_post_status_idx.
create function kc_access.post_seat_tally(p_post_id uuid)
returns table (taken integer, waitlisted integer)
language sql
stable
security definer
set search_path = ''
as $$
  select kc_private.handoff_seats_taken(p_post_id),
         (select count(*)::integer from public.post_handoffs h
           where h.post_id = p_post_id and h.status = 'waitlisted');
$$;
comment on function kc_access.post_seat_tally(uuid) is
  'Seats held on a post and registrations on its waiting list; released only through post_seat_counts.';
grant execute on function kc_access.post_seat_tally(uuid) to authenticated;

-- Seats of the listed event and ride posts the caller can read (at most 100 ids). One row
-- per readable post: its capacity (an event's places, null when unlimited; a ride offer's
-- seats; null for a ride request, whose seats are passengers asking), the seats held, the
-- registrations waiting, and the seats left (null when the capacity is). Other posts and
-- posts the caller cannot read are left out.
create function public.post_seat_counts(p_post_ids uuid[])
returns table (post_id uuid, capacity integer, seats_taken integer, waitlisted integer, seats_left integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.id, cap.capacity, t.taken, t.waitlisted,
         case when cap.capacity is not null then greatest(cap.capacity - t.taken, 0) end
    from public.posts p
    left join public.post_event_details e on e.post_id = p.id
    left join public.post_ride_details r on r.post_id = p.id
    cross join lateral (
      select case p.post_type
               when 'event' then e.capacity
               when 'ride' then case when p.direction = 'offer' then r.seats::integer end
             end as capacity) cap
    cross join lateral kc_access.post_seat_tally(p.id) t
   where p.id = any (p_post_ids[1:100])
     and (e.post_id is not null or r.post_id is not null);
$$;
comment on function public.post_seat_counts(uuid[]) is
  'Capacity, seats held, waiting registrations and seats left of the listed event and ride posts the caller can read.';
grant execute on function public.post_seat_counts(uuid[]) to authenticated;
