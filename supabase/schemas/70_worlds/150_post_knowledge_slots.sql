-- Worlds · post_knowledge_slots (bookable times of a lesson or consulting offer, FR-KNOW-004)
--
-- The knowledge world needs one thing the generic flow does not have: several bookable
-- times on one post, each with its own places. Everything else of a knowledge post stays
-- in `posts.details`, and a booking is an ordinary handoff of the giving machine: the
-- giver approves it with public.confirm_item_handoff, either side cancels with
-- public.cancel_giving_handoff, and public.mark_giving_handed_over completes the session.
-- A booking is tied to its slot by (post_id, slot_starts_at): slots of a post never
-- overlap, so the start identifies the slot.

create table public.post_knowledge_slots (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts (id) on delete cascade,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  -- Learners per slot.
  capacity   smallint not null default 1 check (capacity between 1 and 20),
  created_at timestamptz not null default now(),
  -- A session lasts 15 minutes to 8 hours.
  constraint post_knowledge_slots_length_chk
    check (ends_at - starts_at between interval '15 minutes' and interval '8 hours'),
  -- Slots of one post never overlap. The constraint's index also serves "slots of a post"
  -- and the post foreign key.
  constraint post_knowledge_slots_no_overlap_excl
    exclude using gist (post_id with =, tstzrange(starts_at, ends_at) with &&)
);
comment on table public.post_knowledge_slots is
  'Bookable times of a knowledge offer, each with its own places; bookings are handoffs keyed by the slot start.';

-- Places of a slot held by waiting, approved and completed bookings.
create function kc_private.knowledge_slot_seats_taken(p_post_id uuid, p_starts_at timestamptz)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(h.seats), 0)::integer
    from public.post_handoffs h
   where h.post_id = p_post_id and h.slot_starts_at = p_starts_at
     and h.status in ('reserved', 'confirmed', 'handed_over');
$$;
comment on function kc_private.knowledge_slot_seats_taken(uuid, timestamptz) is
  'Places of a knowledge slot held by live or completed bookings.';

-- Rules of a slot on every write:
--   post      a knowledge offer (post_details_mismatch); whose, the policies below decide
--   new slot  starts in the future, at most 20 per post (slot_started, knowledge_slots_limit)
--   booked    a slot somebody holds is not moved or removed, and its places are not cut
--             below its bookings (knowledge_slot_has_booking); it leaves with its post
create function kc_private.post_knowledge_slots_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_taken constant integer := case when tg_op <> 'INSERT'
    then kc_private.knowledge_slot_seats_taken(old.post_id, old.starts_at) else 0 end;
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.posts p
                    where p.id = new.post_id and p.world_slug = 'knowledge' and p.direction = 'offer') then
      raise exception 'post_details_mismatch' using errcode = 'P0001';
    end if;
    if new.starts_at <= now() then
      raise exception 'slot_started' using errcode = 'P0001';
    end if;
    if (select count(*) from public.post_knowledge_slots s where s.post_id = new.post_id) >= 20 then
      raise exception 'knowledge_slots_limit' using errcode = 'P0001';
    end if;
  -- When the post itself is being removed its row is already gone, and the slot follows.
  elsif v_taken > 0 and exists (select 1 from public.posts p where p.id = old.post_id)
        and (tg_op = 'DELETE' or (new.starts_at, new.ends_at) is distinct from (old.starts_at, old.ends_at)
             or new.capacity < v_taken) then
    raise exception 'knowledge_slot_has_booking' using errcode = 'P0001';
  end if;
  return case tg_op when 'DELETE' then old else new end;
end;
$$;
comment on function kc_private.post_knowledge_slots_guard() is
  'BEFORE INSERT OR UPDATE OR DELETE on post_knowledge_slots: knowledge offer, future start, slot limit, booked slots stay.';

create trigger post_knowledge_slots_guard
  before insert or update or delete on public.post_knowledge_slots
  for each row execute function kc_private.post_knowledge_slots_guard();

-- The offer expires 30 minutes after its last slot ends (FR-KNOW-003 AC3); an offer
-- without slots does not expire.
create function kc_private.post_knowledge_slots_sync_expiry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post_id constant uuid := case tg_op when 'DELETE' then old.post_id else new.post_id end;
begin
  update public.posts p
     set expires_at = (select max(s.ends_at) + interval '30 minutes'
                         from public.post_knowledge_slots s where s.post_id = v_post_id)
   where p.id = v_post_id;
  return null;
end;
$$;
comment on function kc_private.post_knowledge_slots_sync_expiry() is
  'AFTER write on post_knowledge_slots: the post expires 30 minutes after its last slot.';

create trigger post_knowledge_slots_sync_expiry
  after insert or delete or update of ends_at on public.post_knowledge_slots
  for each row execute function kc_private.post_knowledge_slots_sync_expiry();

alter table public.post_knowledge_slots enable row level security;
alter table public.post_knowledge_slots force row level security;

-- Visible exactly when the post is.
create policy post_knowledge_slots_select_visible on public.post_knowledge_slots
  for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_knowledge_slots.post_id));

-- The giver adds, changes and removes slots while the post's content is editable.
create policy post_knowledge_slots_insert_owner on public.post_knowledge_slots
  for insert to authenticated
  with check (exists (select 1 from public.posts p
                       where p.id = post_knowledge_slots.post_id and p.owner_id = (select auth.uid())
                         and p.status in ('draft', 'open', 'paused')));
create policy post_knowledge_slots_update_owner on public.post_knowledge_slots
  for update to authenticated
  using (exists (select 1 from public.posts p
                  where p.id = post_knowledge_slots.post_id and p.owner_id = (select auth.uid())
                    and p.status in ('draft', 'open', 'paused')));
create policy post_knowledge_slots_delete_owner on public.post_knowledge_slots
  for delete to authenticated
  using (exists (select 1 from public.posts p
                  where p.id = post_knowledge_slots.post_id and p.owner_id = (select auth.uid())
                    and p.status in ('draft', 'open', 'paused')));

grant select, delete on public.post_knowledge_slots to authenticated;
grant insert (post_id, starts_at, ends_at, capacity) on public.post_knowledge_slots to authenticated;
-- The slot cannot be moved to another post.
grant update (starts_at, ends_at, capacity) on public.post_knowledge_slots to authenticated;

-- Books a place in a slot that has not started. The booking waits for the giver and
-- lapses 24 hours after it was made or at the start of the slot, whichever is earlier.
--   listing_not_available  no such slot, or its post is not open to the caller
--   slot_started · slots_exhausted · own_listing · item_already_reserved
create function public.book_knowledge_seat(p_slot_id uuid)
returns public.post_handoffs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_active_caller();
  v_post public.posts;
  v_slot public.post_knowledge_slots;
begin
  -- The post row lock serializes bookings, so the last place is given once.
  select p.* into v_post from public.posts p
   where p.id = (select s.post_id from public.post_knowledge_slots s where s.id = p_slot_id)
     for update;
  select s.* into v_slot from public.post_knowledge_slots s where s.id = p_slot_id;
  if not found or not kc_private.post_bookable_by(v_post, v_user_id) then
    raise exception 'listing_not_available' using errcode = 'P0001';
  end if;
  if v_slot.starts_at <= now() then
    raise exception 'slot_started' using errcode = 'P0001';
  end if;
  if kc_private.knowledge_slot_seats_taken(v_slot.post_id, v_slot.starts_at) >= v_slot.capacity then
    raise exception 'slots_exhausted' using errcode = 'P0001';
  end if;
  return kc_private.handoff_open(
    v_slot.post_id, v_user_id, 'reserved', null, 1,
    jsonb_build_object(
      'slot_starts_at', v_slot.starts_at, 'slot_ends_at', v_slot.ends_at,
      'confirm_by', least(now() + interval '24 hours', v_slot.starts_at)));
end;
$$;
comment on function public.book_knowledge_seat(uuid) is
  'The caller books a place in a knowledge slot; the giver approves within 24 hours or by the start.';
grant execute on function public.book_knowledge_seat(uuid) to authenticated;
