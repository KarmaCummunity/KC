-- 0563_event_posts | G1 step 5a (ADR-006, D31, G18): an organization's event is a post of the
-- time world with a 1:1 extension, and its registrations are post handoffs.
--
-- An event is created like every other listing-world post: the create form calls
-- create_marketplace_listing with the time world's `org_event` kind, the listing is the native
-- record and its post is the one detail screen (0557, step 4). This migration adds:
--   1. the `org_event` kind (date window, optional capacity, registration policy, address, and
--      the organization it is published for);
--   2. a guard on listings: only a member of that organization (any role — an employee or an
--      affiliated volunteer posting on its behalf, D31) may publish or edit its event, the
--      window must end after it starts, and the event is public (the time world otherwise keeps
--      its listings to followers only);
--   3. `event_post_details`, the post's 1:1 extension, kept from the listing's details, and
--      `posts.post_type = 'event'` on the event's post;
--   4. registration on `post_handoffs` (world `time`, one seat each): register, approve or
--      decline (manual policy), cancel, and the organizer's roster. `automatic` confirms at once,
--      `manual` waits for the organizer, `verified_only` confirms a verified member and refuses
--      the rest. A full event refuses new registrations; there is no waitlist yet.
--   5. event registrations are not mirrored into `giving_handoffs`: no legacy reader exists for
--      them, so `post_handoffs` is their only record from the start.
-- Attendance and its karma (S13), an organizer acting for colleagues' events, notifications and
-- closing the event at its date (D21) follow in later steps. Additive and idempotent.

begin;

-- ── 1. The event kind of the time world ─────────────────────────────────────────────
-- sort_order 3 keeps `volunteer_shift` the time world's first "give" kind in the create form.
insert into public.listing_kinds (world_slug, slug, label_he, label_en, direction, detail_schema, default_ttl_hours, sort_order)
values (
  'time', 'org_event', 'אירוע של ארגון', 'Organization event', 'give',
  '{
    "type":"object",
    "additionalProperties":false,
    "required":["org_id","starts_at","ends_at","registration_policy"],
    "properties":{
      "org_id":{"type":"string","minLength":36,"maxLength":36},
      "starts_at":{"type":"string","format":"date-time"},
      "ends_at":{"type":"string","format":"date-time"},
      "capacity":{"type":"integer","minimum":1,"maximum":5000},
      "registration_policy":{"enum":["automatic","manual","verified_only"]},
      "address":{"type":"string","minLength":2,"maxLength":160}
    }
  }'::jsonb,
  null, 3)
on conflict (world_slug, slug) do update
  set label_he = excluded.label_he,
      label_en = excluded.label_en,
      direction = excluded.direction,
      detail_schema = excluded.detail_schema,
      sort_order = excluded.sort_order;

-- True for the time world's event kind.
create or replace function public.is_event_kind(p_kind_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1 from public.listing_kinds k
     where k.kind_id = p_kind_id and k.world_slug = 'time' and k.slug = 'org_event');
$$;

revoke all on function public.is_event_kind(uuid) from public, anon, authenticated;
grant execute on function public.is_event_kind(uuid) to service_role;

-- ── 2. Only a member of the organization publishes its event ───────────────────────
create or replace function public.listings_event_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_ref text := new.details ->> 'org_id';
begin
  if not public.is_event_kind(new.kind_id) then
    return new;
  end if;
  -- An organization's event is public (D90): the time world caps its listings at followers only
  -- (listings_before_write_trg, which runs before this trigger by name), an event is not.
  new.anonymity_level := 3;
  new.visibility := public.anonymity_level_to_visibility(3);
  -- A status or moderation change of an existing event keeps its checked details.
  if tg_op = 'UPDATE' and new.details is not distinct from old.details and new.owner_id = old.owner_id then
    return new;
  end if;

  if v_org_ref is null
     or v_org_ref !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or not exists (
       select 1 from public.org_memberships m
        where m.org_id = v_org_ref::uuid and m.user_id = new.owner_id) then
    raise exception 'event_org_required' using errcode = '42501';
  end if;
  if (new.details ->> 'ends_at')::timestamptz <= (new.details ->> 'starts_at')::timestamptz then
    raise exception 'event_window_invalid' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.listings_event_guard() from public, anon, authenticated;

drop trigger if exists listings_event_guard on public.listings;
create trigger listings_event_guard
  before insert or update on public.listings
  for each row when (new.world_slug = 'time')
  execute function public.listings_event_guard();

-- ── 3. The post's event extension ───────────────────────────────────────────────────
create table if not exists public.event_post_details (
  post_id              uuid primary key references public.posts(post_id) on delete cascade,
  org_id               uuid not null references public.organizations(org_id) on delete cascade,
  starts_at            timestamptz not null,
  ends_at              timestamptz not null,
  capacity             integer check (capacity is null or capacity between 1 and 5000),
  registration_policy  text not null check (registration_policy in ('automatic', 'manual', 'verified_only')),
  address              text check (address is null or char_length(address) between 2 and 160),
  updated_at           timestamptz not null default now(),
  constraint event_post_details_window_chk check (ends_at > starts_at)
);

comment on table public.event_post_details is
  'G1 step 5 (D31): 1:1 extension of an event post — the organization it is for, its window, capacity and registration policy. Kept from the event listing''s details until step 6.';

create index if not exists event_post_details_org_idx on public.event_post_details (org_id, starts_at);

create or replace trigger event_post_details_set_updated_at
  before update on public.event_post_details
  for each row execute function public.set_updated_at();

-- An event's details are visible exactly when its post is; clients never write.
alter table public.event_post_details enable row level security;

drop policy if exists event_post_details_select_visible on public.event_post_details;
create policy event_post_details_select_visible on public.event_post_details
  for select to authenticated
  using (exists (
    select 1 from public.posts p
     where p.post_id = event_post_details.post_id
       and public.is_post_visible_to(p, (select auth.uid()))
  ));

revoke all on public.event_post_details from public, anon;
revoke insert, update, delete on public.event_post_details from authenticated;
grant select on public.event_post_details to authenticated;

-- The event's post is of post type `event`. Runs after posts_one_model_derive (name order), which
-- keeps any type other than `ride`, so the mirror writers' 'standard' never sticks.
create or replace function public.posts_event_type()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.listings l
     where l.listing_id = new.listing_id and public.is_event_kind(l.kind_id)) then
    new.post_type := 'event';
  end if;
  return new;
end;
$$;

revoke all on function public.posts_event_type() from public, anon, authenticated;

drop trigger if exists posts_one_model_event_type on public.posts;
create trigger posts_one_model_event_type
  before insert or update on public.posts
  for each row when (new.listing_id is not null)
  execute function public.posts_event_type();

-- The extension follows the listing's details. Fires after listings_feed_mirror_sync (name
-- order), so a published event's post already exists; a pending one gets it on publication.
create or replace function public.listings_sync_event_post_details()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post_id uuid;
begin
  if not public.is_event_kind(new.kind_id) then
    return null;
  end if;
  v_post_id := public.post_id_of_listing(new.listing_id);
  if v_post_id is null then
    return null;
  end if;

  insert into public.event_post_details as e (
    post_id, org_id, starts_at, ends_at, capacity, registration_policy, address
  ) values (
    v_post_id, (new.details ->> 'org_id')::uuid, (new.details ->> 'starts_at')::timestamptz,
    (new.details ->> 'ends_at')::timestamptz, (new.details ->> 'capacity')::integer,
    new.details ->> 'registration_policy', nullif(trim(coalesce(new.details ->> 'address', '')), '')
  )
  on conflict (post_id) do update
    set org_id = excluded.org_id,
        starts_at = excluded.starts_at,
        ends_at = excluded.ends_at,
        capacity = excluded.capacity,
        registration_policy = excluded.registration_policy,
        address = excluded.address
  where (e.org_id, e.starts_at, e.ends_at, e.capacity, e.registration_policy, e.address)
        is distinct from
        (excluded.org_id, excluded.starts_at, excluded.ends_at, excluded.capacity,
         excluded.registration_policy, excluded.address);
  return null;
end;
$$;

revoke all on function public.listings_sync_event_post_details() from public, anon, authenticated;

drop trigger if exists listings_sync_event_post_details on public.listings;
create trigger listings_sync_event_post_details
  after insert or update of details, status, moderation_status, owner_id on public.listings
  for each row when (new.world_slug = 'time')
  execute function public.listings_sync_event_post_details();

-- ── 4. Event registrations are post handoffs only ────────────────────────────────────
-- 0555 body, plus: a time-world handoff (an event registration) has no giving_handoffs row.
create or replace function public.post_handoffs_giving_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.giving_handoffs where handoff_id = old.handoff_id;
    return old;
  end if;
  if new.world_slug = 'time' then
    return new;
  end if;
  perform public.giving_handoff_upsert_from_post_handoff(new);
  return new;
end;
$$;

revoke all on function public.post_handoffs_giving_sync() from public, anon, authenticated;

-- ── 5. Register, decide, cancel, roster ──────────────────────────────────────────────
-- Registers the caller for an event (post id or listing id). Error codes match the other booking
-- RPCs so the app maps them the same way.
create or replace function public.register_for_event(p_target uuid)
returns public.post_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_post_id uuid := public.handoff_target_post_id(p_target);
  v_event public.event_post_details;
  v_listing public.listings;
  v_taken integer;
  v_manual boolean;
  v_row public.post_handoffs;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  select * into v_event from public.event_post_details where post_id = v_post_id;
  if not found then raise exception 'listing_not_available' using errcode = 'P0002'; end if;
  -- The listing row lock serializes registrations, so capacity cannot be overbooked.
  select * into v_listing from public.listings
   where listing_id = public.listing_id_of_post(v_post_id) and status = 'open'
   for update;
  if not found or not public.is_listing_visible_to(v_listing, v_uid) then
    raise exception 'listing_not_available' using errcode = 'P0002';
  end if;
  if v_listing.owner_id = v_uid then raise exception 'own_listing' using errcode = '23514'; end if;
  if v_event.starts_at <= now() then raise exception 'slot_started' using errcode = '23514'; end if;
  if v_event.registration_policy = 'verified_only'
     and not exists (select 1 from public.users u where u.user_id = v_uid and u.verified_at is not null) then
    raise exception 'verification_required' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.post_handoffs
     where post_id = v_post_id and recipient_id = v_uid and status in ('reserved', 'confirmed')
  ) then
    raise exception 'already_booked' using errcode = '23505';
  end if;
  if v_event.capacity is not null then
    select count(*)::integer into v_taken from public.post_handoffs
     where post_id = v_post_id and status in ('reserved', 'confirmed', 'handed_over');
    if v_taken >= v_event.capacity then raise exception 'slots_exhausted' using errcode = 'P0001'; end if;
  end if;

  v_manual := v_event.registration_policy = 'manual';
  insert into public.post_handoffs (
    post_id, owner_id, recipient_id, world_slug, status, seats,
    slot_starts_at, slot_ends_at, confirm_by, confirmed_at
  ) values (
    v_post_id, v_listing.owner_id, v_uid, 'time',
    case when v_manual then 'reserved' else 'confirmed' end, 1,
    v_event.starts_at, v_event.ends_at,
    case when v_manual then v_event.starts_at end,
    case when v_manual then null else now() end
  )
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.register_for_event(uuid) from public, anon;
grant execute on function public.register_for_event(uuid) to authenticated;

-- Locks an event registration the caller may act on, or raises.
create or replace function public.event_registration_for_update(p_handoff_id uuid)
returns public.post_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.post_handoffs;
begin
  select h.* into v_row from public.post_handoffs h
   where h.handoff_id = p_handoff_id and h.world_slug = 'time'
     and exists (select 1 from public.event_post_details e where e.post_id = h.post_id)
     and auth.uid() in (h.owner_id, h.recipient_id)
   for update of h;
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;
  return v_row;
end;
$$;

revoke all on function public.event_registration_for_update(uuid) from public, anon, authenticated;
grant execute on function public.event_registration_for_update(uuid) to service_role;

-- The organizer approves or declines a registration waiting for approval (manual policy).
create or replace function public.decide_event_registration(p_handoff_id uuid, p_approve boolean)
returns public.post_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.post_handoffs := public.event_registration_for_update(p_handoff_id);
begin
  if v_row.owner_id <> auth.uid() then raise exception 'not_owner' using errcode = '42501'; end if;
  if v_row.status <> 'reserved' then raise exception 'invalid_transition' using errcode = '23514'; end if;

  if p_approve then
    update public.post_handoffs set status = 'confirmed', confirmed_at = now()
     where handoff_id = p_handoff_id returning * into v_row;
  else
    update public.post_handoffs set status = 'cancelled', cancel_reason = 'declined', cancelled_at = now()
     where handoff_id = p_handoff_id returning * into v_row;
  end if;
  return v_row;
end;
$$;

revoke all on function public.decide_event_registration(uuid, boolean) from public, anon;
grant execute on function public.decide_event_registration(uuid, boolean) to authenticated;

-- The registrant withdraws, or the organizer removes a registration (recorded as declined).
create or replace function public.cancel_event_registration(p_handoff_id uuid)
returns public.post_handoffs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.post_handoffs := public.event_registration_for_update(p_handoff_id);
begin
  if v_row.status not in ('reserved', 'confirmed') then
    raise exception 'invalid_transition' using errcode = '23514';
  end if;
  update public.post_handoffs
     set status = 'cancelled',
         cancel_reason = case when auth.uid() = owner_id then 'declined' end,
         cancelled_at = now()
   where handoff_id = p_handoff_id
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.cancel_event_registration(uuid) from public, anon;
grant execute on function public.cancel_event_registration(uuid) to authenticated;

-- The organizer's roster of an event (post id or listing id), newest first.
create or replace function public.list_event_registrations(p_target uuid)
returns table (
  handoff_id uuid,
  recipient_id uuid,
  display_name text,
  status text,
  reserved_at timestamptz,
  confirmed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_post_id uuid := public.handoff_target_post_id(p_target);
begin
  if not exists (
    select 1 from public.posts p
      join public.event_post_details e on e.post_id = p.post_id
     where p.post_id = v_post_id and p.owner_id = auth.uid()
  ) then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  return query
    select h.handoff_id, h.recipient_id, u.display_name, h.status, h.reserved_at, h.confirmed_at
      from public.post_handoffs h
      join public.users u on u.user_id = h.recipient_id
     where h.post_id = v_post_id
     order by h.reserved_at desc;
end;
$$;

revoke all on function public.list_event_registrations(uuid) from public, anon;
grant execute on function public.list_event_registrations(uuid) to authenticated;

commit;
