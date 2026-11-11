-- 0600_housing_stays_catalog | Housing H1, part 1: sub-categories, binding stay schemas,
-- stay rules and the code of conduct (spec docs/SSOT/spec/21_housing.md; product book
-- docs/spec/05 §5.6).
--
--   1. Housing sub-categories (§1): the six legacy place-type rows become inactive and four
--      sub-categories take their place; existing housing listings move to `stays`.
--   2. Binding detail schemas for the stay kinds `host_offer` (FR-HOUSING-005, 011) and
--      `stay_request` (FR-HOUSING-006); the 0540 trigger enforces them on native listings.
--   3. Housing listings are public by default (FR-HOUSING-004 AC4): the world default stops
--      capping them at followers-only.
--   4. Code of conduct (FR-HOUSING-003 AC3): versioned acceptances, the current version in
--      the rules catalog (`R-Housing-2`), and `accept_housing_conduct`.
--   5. `listings_world_housing_rules` (BEFORE trigger): sub-category from the kind, conduct gate on
--      publish, the cross-field rules a JSON schema cannot express, and the listing expiry
--      (D21: an offer at the end of its availability window, a request at its check-out).
-- Verification of both sides (D30, FR-HOUSING-003 AC1) needs no change here: the housing
-- world already has `requires_verification`, which `has_world_permission` enforces (0264).

begin;

-- ── 1. Housing sub-categories ────────────────────────────────────────────────
update public.categories
   set is_active = false
 where world_slug = 'housing'
   and slug in ('family-room', 'whole-unit', 'sofa', 'outdoor', 'secondary-unit', 'emergency');

insert into public.categories (world_slug, parent_id, slug, label_he, label_en, sort_order)
select 'housing', root.category_id, v.slug, v.label_he, v.label_en, v.ord
  from public.categories root
 cross join (values
   ('stays',             'לינה ואירוח',          'Stays & hosting',           1),
   ('emergency-shelter', 'קורת גג בחירום',       'Emergency shelter',         2),
   ('event-space',       'מקום לאירוע ולמפגש',   'Event & gathering space',   3),
   ('storage',           'שטח לאחסון',           'Storage space',             4)
 ) as v(slug, label_he, label_en, ord)
 where root.world_slug = 'housing' and root.slug = 'housing'
on conflict (world_slug, slug) do update
  set is_active = true, label_he = excluded.label_he, label_en = excluded.label_en,
      sort_order = excluded.sort_order;

-- Every housing listing so far is a stay listing (the only kinds that existed).
update public.listings l
   set category_id = c.category_id
  from public.categories c
 where l.world_slug = 'housing'
   and c.world_slug = 'housing' and c.slug = 'stays'
   and l.category_id is distinct from c.category_id;

-- ── 2. Binding stay schemas ──────────────────────────────────────────────────
update public.listing_kinds
   set detail_schema = $schema$
{
  "type": "object",
  "additionalProperties": false,
  "required": ["place_type", "capacity", "exclusive", "min_nights", "max_nights",
               "check_in_from", "check_in_until", "check_out_by", "guest_policy",
               "children_ok", "pets_ok", "smoking", "availability"],
  "properties": {
    "place_type": {"enum": ["private_room", "shared_room", "couch", "whole_unit", "secondary_unit", "tent_pitch"]},
    "capacity": {"type": "integer", "minimum": 1, "maximum": 20},
    "exclusive": {"type": "boolean"},
    "min_nights": {"type": "integer", "minimum": 1, "maximum": 30},
    "max_nights": {"type": "integer", "minimum": 1, "maximum": 30},
    "check_in_from": {"type": "string", "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$"},
    "check_in_until": {"type": "string", "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$"},
    "check_out_by": {"type": "string", "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$"},
    "guest_policy": {"enum": ["any", "women_only", "men_only", "families_only", "couples_and_families"]},
    "children_ok": {"type": "boolean"},
    "pets_ok": {"type": "boolean"},
    "smoking": {"enum": ["no", "outside_only", "yes"]},
    "household": {"type": "array", "uniqueItems": true, "maxItems": 5,
      "items": {"enum": ["kosher_kitchen", "shabbat_observant", "vegetarian_kitchen", "pets_in_home", "kids_in_home"]}},
    "amenities": {"type": "array", "uniqueItems": true, "maxItems": 14,
      "items": {"enum": ["shower", "hot_water", "kitchen", "laundry", "wifi", "heating", "ac", "parking",
                         "bedding", "towels", "electricity", "drinking_water", "toilet", "safe_room"]}},
    "accessibility": {"type": "array", "uniqueItems": true, "maxItems": 4,
      "items": {"enum": ["step_free_entry", "elevator", "accessible_bathroom", "ground_floor"]}},
    "languages": {"type": "array", "uniqueItems": true, "maxItems": 10,
      "items": {"type": "string", "pattern": "^[a-z]{2}$"}},
    "near_trail": {"enum": ["israel_national_trail", "jerusalem_trail", "kinneret_trail", "golan_trail", "other_trail"]},
    "trail_distance_km": {"type": "number", "minimum": 0, "maximum": 20},
    "trail_pickup": {"type": "boolean"},
    "meal_offered": {"type": "boolean"},
    "no_facilities_ack": {"type": "boolean"},
    "house_rules": {"type": "string", "maxLength": 300},
    "availability": {
      "type": "object",
      "additionalProperties": false,
      "required": ["mode"],
      "properties": {
        "mode": {"enum": ["window", "weekly", "ongoing"]},
        "from": {"type": "string", "format": "date"},
        "until": {"type": "string", "format": "date"},
        "weekdays": {"type": "array", "uniqueItems": true, "minItems": 1, "maxItems": 7,
          "items": {"type": "integer", "minimum": 0, "maximum": 6}},
        "end_date": {"type": "string", "format": "date"}
      }
    },
    "blackout_dates": {"type": "array", "uniqueItems": true, "maxItems": 60,
      "items": {"type": "string", "format": "date"}}
  }
}
$schema$::jsonb
 where world_slug = 'housing' and slug = 'host_offer';

update public.listing_kinds
   set detail_schema = $schema$
{
  "type": "object",
  "additionalProperties": false,
  "required": ["stay_purpose", "check_in_date", "check_out_date", "adults", "minors"],
  "properties": {
    "stay_purpose": {"enum": ["trail_walk", "travel_tourism", "family_visit", "medical_companion",
                              "study_exam", "work_trip", "evacuation", "other"]},
    "check_in_date": {"type": "string", "format": "date"},
    "check_out_date": {"type": "string", "format": "date"},
    "flexible_days": {"type": "integer", "minimum": 0, "maximum": 3},
    "adults": {"type": "integer", "minimum": 1, "maximum": 8},
    "minors": {"type": "integer", "minimum": 0, "maximum": 7},
    "arrival_time": {"type": "string", "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$"},
    "needs": {"type": "array", "uniqueItems": true, "maxItems": 6,
      "items": {"enum": ["step_free_entry", "accessible_bathroom", "kosher_kitchen", "pets", "parking", "quiet"]}},
    "place_types": {"type": "array", "uniqueItems": true, "maxItems": 6,
      "items": {"enum": ["private_room", "shared_room", "couch", "whole_unit", "secondary_unit", "tent_pitch"]}},
    "near_trail": {"enum": ["israel_national_trail", "jerusalem_trail", "kinneret_trail", "golan_trail", "other_trail"]},
    "gear": {"type": "array", "uniqueItems": true, "maxItems": 3,
      "items": {"enum": ["tent", "sleeping_bag", "mat"]}}
  }
}
$schema$::jsonb
 where world_slug = 'housing' and slug = 'stay_request';

-- ── 3. Housing listings are public by default ────────────────────────────────
update public.worlds set default_anonymity_level = 3 where slug = 'housing';

-- ── 4. Code of conduct ───────────────────────────────────────────────────────
insert into public.marketplace_rules (rule_code, world_slug, label_en)
values ('R-Housing-2', 'housing', 'Housing code of conduct accepted before the first publish or booking')
on conflict (rule_code) do nothing;

insert into public.marketplace_rule_params (rule_code, param_key, param_value)
values ('R-Housing-2', 'current_version', '1')
on conflict (rule_code, param_key) do nothing;

create table if not exists public.housing_conduct_acceptances (
  user_id      uuid not null references public.users(user_id) on delete cascade,
  version      integer not null check (version >= 1),
  accepted_at  timestamptz not null default now(),
  primary key (user_id, version)
);

comment on table public.housing_conduct_acceptances is
  'One row per member and accepted version of the housing code of conduct (FR-HOUSING-003 AC3). 0600.';

alter table public.housing_conduct_acceptances enable row level security;

create policy housing_conduct_acceptances_own_read on public.housing_conduct_acceptances
  for select to authenticated
  using (user_id = (select auth.uid()));
-- No client INSERT / UPDATE / DELETE: acceptances are written by accept_housing_conduct only.

-- The version members must have accepted now (rules catalog, so it is tunable without a migration).
create or replace function public.housing_conduct_version()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select (param_value #>> '{}')::integer
       from public.marketplace_rule_params
      where rule_code = 'R-Housing-2' and param_key = 'current_version'),
    1);
$$;

create or replace function public.has_accepted_housing_conduct(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.housing_conduct_acceptances a
     where a.user_id = p_user and a.version = public.housing_conduct_version()
  );
$$;

-- Records the caller's acceptance of the current version. Idempotent; an old version is refused
-- so a stale client cannot accept a text the member never saw.
create or replace function public.accept_housing_conduct(p_version integer)
returns public.housing_conduct_acceptances
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.housing_conduct_acceptances;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  if p_version is distinct from public.housing_conduct_version() then
    raise exception 'housing_conduct_version_stale' using errcode = '22023';
  end if;
  insert into public.housing_conduct_acceptances (user_id, version)
  values (v_uid, p_version)
  on conflict (user_id, version) do nothing;
  select * into v_row from public.housing_conduct_acceptances
   where user_id = v_uid and version = p_version;
  return v_row;
end;
$$;

-- ── 5. Housing listing rules ─────────────────────────────────────────────────
-- Today's date in Israel: every housing date is a local calendar date.
create or replace function public.housing_today()
returns date
language sql
stable
as $$
  select (now() at time zone 'Asia/Jerusalem')::date;
$$;

-- The instant a local Israel date starts (00:00 Asia/Jerusalem).
create or replace function public.housing_local_midnight(p_day date)
returns timestamptz
language sql
immutable
as $$
  select p_day::timestamp at time zone 'Asia/Jerusalem';
$$;

-- Offer rules beyond the schema (FR-HOUSING-005 AC1–AC2, FR-HOUSING-011). Returns the
-- listing expiry: the day after the last available night, or null for an open-ended offer.
create or replace function public.housing_check_offer_details(p_details jsonb, p_is_insert boolean)
returns timestamptz
language plpgsql
stable
set search_path = public
as $$
declare
  v_avail jsonb := p_details->'availability';
  v_mode text := v_avail->>'mode';
  v_place text := p_details->>'place_type';
  v_amenities jsonb := coalesce(p_details->'amenities', '[]'::jsonb);
begin
  if (p_details->>'min_nights')::int > (p_details->>'max_nights')::int then
    raise exception 'housing_nights_out_of_range' using errcode = '23514';
  end if;
  -- The check-in window may run past midnight, up to 02:00.
  if (p_details->>'check_in_from') >= (p_details->>'check_in_until')
     and (p_details->>'check_in_until') > '02:00' then
    raise exception 'housing_dates_invalid' using errcode = '23514';
  end if;
  if v_place in ('shared_room', 'couch') and (p_details->>'exclusive')::boolean then
    raise exception 'housing_details_invalid' using errcode = '23514',
      detail = 'a shared room or a couch cannot be booked exclusively';
  end if;
  -- A tent pitch states its facilities, or explicitly that there are none (PRD edge case).
  if v_place = 'tent_pitch'
     and not (v_amenities ? 'toilet' or v_amenities ? 'drinking_water')
     and coalesce((p_details->>'no_facilities_ack')::boolean, false) is not true then
    raise exception 'housing_tent_facilities_required' using errcode = '23514';
  end if;
  if p_details ? 'near_trail' and not p_details ? 'trail_distance_km' then
    raise exception 'housing_details_invalid' using errcode = '23514',
      detail = 'a trail host states the distance from the trail';
  end if;

  if v_mode = 'window' then
    if not (v_avail ? 'from' and v_avail ? 'until')
       or (v_avail->>'from')::date > (v_avail->>'until')::date then
      raise exception 'housing_dates_invalid' using errcode = '23514';
    end if;
    if p_is_insert and (v_avail->>'until')::date < public.housing_today() then
      raise exception 'housing_dates_invalid' using errcode = '23514';
    end if;
    return public.housing_local_midnight((v_avail->>'until')::date + 1);
  elsif v_mode = 'weekly' then
    if not v_avail ? 'weekdays' then
      raise exception 'housing_dates_invalid' using errcode = '23514';
    end if;
    if v_avail ? 'end_date' then
      return public.housing_local_midnight((v_avail->>'end_date')::date + 1);
    end if;
  end if;
  return null; -- ongoing, or weekly without an end: relevance reminders instead (D59)
end;
$$;

-- Request rules beyond the schema (FR-HOUSING-006). Returns the listing expiry: the end of
-- the latest possible check-out day (D21 "stay dates").
create or replace function public.housing_check_request_details(p_details jsonb, p_is_insert boolean)
returns timestamptz
language plpgsql
stable
set search_path = public
as $$
declare
  v_in date := (p_details->>'check_in_date')::date;
  v_out date := (p_details->>'check_out_date')::date;
begin
  if v_out <= v_in or v_out - v_in > 30 then
    raise exception 'housing_nights_out_of_range' using errcode = '23514';
  end if;
  if p_is_insert and (v_in < public.housing_today() or v_in > public.housing_today() + 180) then
    raise exception 'housing_dates_invalid' using errcode = '23514';
  end if;
  if (p_details->>'adults')::int + (p_details->>'minors')::int > 8 then
    raise exception 'housing_capacity_exceeded' using errcode = '23514';
  end if;
  return public.housing_local_midnight(v_out + coalesce((p_details->>'flexible_days')::int, 0) + 1);
end;
$$;

create or replace function public.listings_housing_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind_slug text;
  v_category_slug text;
begin
  if new.world_slug <> 'housing' or new.origin <> 'native' then
    return new;
  end if;
  select slug into v_kind_slug from public.listing_kinds where kind_id = new.kind_id;

  -- The sub-category follows the kind (§1); the client never chooses it.
  v_category_slug := case v_kind_slug
    when 'host_offer' then 'stays'
    when 'stay_request' then 'stays'
  end;
  if v_category_slug is not null then
    select category_id into new.category_id
      from public.categories where world_slug = 'housing' and slug = v_category_slug;
  end if;

  -- The code of conduct is accepted before the first publish (FR-HOUSING-003 AC3).
  if tg_op = 'INSERT' and not public.has_accepted_housing_conduct(new.owner_id) then
    raise exception 'housing_conduct_required' using errcode = '42501';
  end if;

  if v_kind_slug = 'host_offer' then
    new.expires_at := public.housing_check_offer_details(new.details, tg_op = 'INSERT');
  elsif v_kind_slug = 'stay_request' then
    new.expires_at := public.housing_check_request_details(new.details, tg_op = 'INSERT');
  end if;
  return new;
end;
$$;

comment on function public.listings_housing_rules() is
  'Trigger: housing sub-category from the kind, conduct gate on publish, stay cross-field rules and expiry (FR-HOUSING-003/005/006/011). 0600.';

-- BEFORE triggers fire in name order: this one runs after listings_before_write_trg (so the
-- housing expiry is the final word), listings_require_world_permission (an unverified member
-- hears about verification first, FR-HOUSING-003 AC2) and listings_validate_details_trg (the
-- casts below only ever see schema-valid details).
drop trigger if exists listings_world_housing_rules on public.listings;
create trigger listings_world_housing_rules
  before insert or update of details, kind_id on public.listings
  for each row execute function public.listings_housing_rules();

-- ── Grants (0520: explicit per function) ─────────────────────────────────────
revoke all on function public.housing_conduct_version() from public;
revoke all on function public.has_accepted_housing_conduct(uuid) from public;
revoke all on function public.accept_housing_conduct(integer) from public;
revoke all on function public.housing_today() from public;
revoke all on function public.housing_local_midnight(date) from public;
revoke all on function public.housing_check_offer_details(jsonb, boolean) from public;
revoke all on function public.housing_check_request_details(jsonb, boolean) from public;
revoke all on function public.listings_housing_rules() from public, anon, authenticated;

grant execute on function public.housing_conduct_version() to authenticated, service_role;
-- Internal: a member reads their own acceptance through the table's RLS, never another's.
grant execute on function public.has_accepted_housing_conduct(uuid) to service_role;
grant execute on function public.accept_housing_conduct(integer) to authenticated;
grant execute on function public.housing_today() to authenticated, service_role;
grant execute on function public.housing_local_midnight(date) to authenticated, service_role;
grant execute on function public.housing_check_offer_details(jsonb, boolean) to service_role;
grant execute on function public.housing_check_request_details(jsonb, boolean) to service_role;

commit;
