-- 0459_listing_details_expiry | KC#1294 — honour the expiry the giver sets on a listing.
--
-- The food form requires `details.expires_at` (give_food schema, 0241), but nothing copied
-- it into `listings.expires_at`: `create_marketplace_listing` (0353) inserts no expiry, and
-- `listings_before_write` (0242) then applied the world TTL (food: 168 h). The expiry sweep
-- (0387), the urgency level (0383) and the expired block (0266) all read the column, so food
-- stayed open and claimable for a week whatever the giver entered.
--
-- 1. `listing_details_expires_at(details)`: the giver's expiry from details, null when absent;
--    an unparseable value raises `details_expires_at_invalid` (23514) instead of defaulting.
-- 2. `listings_before_write`: body of 0242; a native listing's `details.expires_at` sets
--    `expires_at` on insert and whenever that detail changes on update. The world TTL still
--    applies when no expiry was given.
-- 3. `food_listing_urgency_level` (0383) returned 4–5 for food expiring within 24 h, outside
--    the column's 1–3 scale (0320: 1 low, 2 normal, 3 urgent). It never surfaced because no
--    food row carried a near expiry; with (2) it would reject every such insert. Food within
--    72 h is urgent (3), later food normal (2), the same order as before.
-- 4. Backfill: open native listings take their stored expiry from details. Food already past
--    it becomes `expired` through `listings_food_expiry_block` (0266).
--
-- Mapped to spec: docs/spec/05_giving_worlds.md (food: expiry required); legacy FR-POST food
-- rules R-Food-1/2. Idempotent.

-- ---------------------------------------------------------------------------
-- 1. Parse the giver's expiry
-- ---------------------------------------------------------------------------

create or replace function public.listing_details_expires_at(p_details jsonb)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_raw text := nullif(trim(p_details->>'expires_at'), '');
begin
  if v_raw is null then
    return null;
  end if;
  return v_raw::timestamptz;
exception
  when invalid_datetime_format or datetime_field_overflow then
    raise exception 'details_expires_at_invalid' using errcode = '23514';
end;
$$;

revoke all on function public.listing_details_expires_at(jsonb) from public, anon, authenticated;

comment on function public.listing_details_expires_at(jsonb) is
  'Internal: the expiry a giver set in listing details (ISO date-time), null when absent; raises details_expires_at_invalid (23514) when unparseable. KC#1294.';

-- ---------------------------------------------------------------------------
-- 2. Trigger — 0242 body plus the details expiry
-- ---------------------------------------------------------------------------

create or replace function public.listings_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_kind_slug text;
  v_world_anon smallint;
  v_ttl_hours integer;
begin
  -- The giver's own expiry wins over the world TTL (KC#1294). On update it is re-read only
  -- when the detail itself changes, so an expiry set some other way is left alone.
  if new.origin = 'native'
     and (tg_op = 'INSERT' or new.details->'expires_at' is distinct from old.details->'expires_at')
     and public.listing_details_expires_at(new.details) is not null then
    new.expires_at := public.listing_details_expires_at(new.details);
  end if;

  if tg_op = 'INSERT' and new.origin = 'native' then
    select w.default_anonymity_level,
           coalesce(lk.default_ttl_hours, w.default_ttl_hours)
      into v_world_anon, v_ttl_hours
      from public.worlds w
      join public.listing_kinds lk on lk.kind_id = new.kind_id
     where w.slug = new.world_slug;

    -- World default caps openness; an explicitly more restrictive level
    -- (lower number) chosen by the author is preserved.
    new.anonymity_level := least(new.anonymity_level, coalesce(v_world_anon, new.anonymity_level));

    if new.expires_at is null and v_ttl_hours is not null then
      new.expires_at := now() + make_interval(hours => v_ttl_hours);
    end if;
  end if;

  new.visibility := public.anonymity_level_to_visibility(new.anonymity_level);

  if new.moderation_status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;

  select lk.slug into v_kind_slug
    from public.listing_kinds lk
   where lk.kind_id = new.kind_id;

  if new.world_slug = 'medical'
     and new.origin = 'native'
     and v_kind_slug in ('blood_appointment','adi_registration','living_donation_intent','blood_urgency_org')
     and new.external_body_id is null then
    raise exception 'medical_listing_requires_external_body'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Food urgency within the 1–3 scale
-- ---------------------------------------------------------------------------

create or replace function public.food_listing_urgency_level(p_expires_at timestamptz)
returns smallint
language sql
stable
as $$
  select case
    when p_expires_at is null then 2
    when p_expires_at <= now() + interval '72 hours' then 3
    else 2
  end::smallint;
$$;

comment on function public.food_listing_urgency_level(timestamptz) is
  'Food urgency on the listings scale (1 low, 2 normal, 3 urgent): urgent within 72 h of expiry. KC#1294.';

-- ---------------------------------------------------------------------------
-- 4. Backfill open listings created before this fix
-- ---------------------------------------------------------------------------

-- Rows with an unparseable stored value are skipped rather than failing the migration.
do $$
declare
  r record;
  v_expires timestamptz;
begin
  for r in
    select listing_id, details
      from public.listings
     where origin = 'native'
       and status = 'open'
       and nullif(trim(details->>'expires_at'), '') is not null
  loop
    begin
      v_expires := (r.details->>'expires_at')::timestamptz;
    exception
      when invalid_datetime_format or datetime_field_overflow then
        continue;
    end;
    update public.listings
       set expires_at = v_expires
     where listing_id = r.listing_id
       and expires_at is distinct from v_expires;
  end loop;
end $$;
