-- Worlds · places left in the slots of a knowledge offer (FR-KNOW-004)
--
-- A learner picks a slot that still has room, so every reader of a knowledge offer sees each
-- slot with its places left. The bookings behind the number are visible to their two members
-- only, so the count is taken by kc_private.knowledge_slot_seats_taken (definer) through a
-- kc_access wrapper, and released by a function that runs with the caller's rights: row
-- security on `post_knowledge_slots` (visible exactly when the post is) decides which slots
-- come back.

create function kc_access.knowledge_slot_seats_taken(p_post_id uuid, p_starts_at timestamptz)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select kc_private.knowledge_slot_seats_taken(p_post_id, p_starts_at);
$$;
comment on function kc_access.knowledge_slot_seats_taken(uuid, timestamptz) is
  'Places of a knowledge slot held by bookings; released only through knowledge_slot_seats.';
grant execute on function kc_access.knowledge_slot_seats_taken(uuid, timestamptz) to authenticated;

-- The slots of a knowledge offer the caller can read, in time order, each with its places,
-- the places held and the places left. Reads the index of
-- post_knowledge_slots_no_overlap_excl (led by post_id) and post_handoffs_post_status_idx.
create function public.knowledge_slot_seats(p_post_id uuid)
returns table (id uuid, starts_at timestamptz, ends_at timestamptz, capacity integer, seats_taken integer,
               seats_left integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select s.id, s.starts_at, s.ends_at, s.capacity::integer, t.taken, greatest(s.capacity - t.taken, 0)
    from public.post_knowledge_slots s
   cross join lateral (select kc_access.knowledge_slot_seats_taken(s.post_id, s.starts_at) as taken) t
   where s.post_id = p_post_id
   order by s.starts_at;
$$;
comment on function public.knowledge_slot_seats(uuid) is
  'Slots of a knowledge offer the caller can read, with places held and places left.';
grant execute on function public.knowledge_slot_seats(uuid) to authenticated;
