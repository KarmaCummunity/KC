-- Worlds · completed stays in a member's housing trust block (S16, D24)
--
-- Stay cards, the host's booking panel and the guest's stays show a member's verification,
-- seniority and the number of housing bookings they completed (FR-HOUSING-013 AC1,
-- FR-HOUSING-021 AC2, FR-HOUSING-036 AC2), never a rating. The bookings behind the number are
-- visible to their two members only, so the count is taken by a definer helper and released
-- through a function that runs with the caller's rights: row security on `users` decides
-- whose count comes back, exactly as for the profile itself.

-- Completed stays of a member, as host or as guest. Reads post_handoffs_owner_recent_idx
-- and post_handoffs_recipient_recent_idx, both led by the member id.
create function kc_access.housing_completed_stays_of(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
    from public.post_handoffs h
   where (h.owner_id = p_user_id or h.recipient_id = p_user_id)
     and h.machine_id = 'housing_booking' and h.status = 'handed_over';
$$;
comment on function kc_access.housing_completed_stays_of(uuid) is
  'Housing bookings a member completed as host or guest; released only through housing_completed_stays.';
grant execute on function kc_access.housing_completed_stays_of(uuid) to authenticated;

-- Completed stays of the listed members whose profile the caller can read (at most 100
-- ids). One row per readable member; other ids are left out.
create function public.housing_completed_stays(p_user_ids uuid[])
returns table (user_id uuid, completed_stays integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select u.id, kc_access.housing_completed_stays_of(u.id)
    from public.users u
   where u.id = any (p_user_ids[1:100]);
$$;
comment on function public.housing_completed_stays(uuid[]) is
  'Completed housing bookings of the listed members whose profile the caller can read (trust block, S16).';
grant execute on function public.housing_completed_stays(uuid[]) to authenticated;
