-- 0612_animals_world_direct | FR-FEED-020 · docs/spec/05_giving_worlds.md (animals) · PM decision 2026-11-04
--
-- The animals world is a direct give-and-take between members (handing an animal over,
-- full or part-time boarding, pet-sitting), offers and requests alike. Until now every animals
-- listing had to be published through a verified external body (R-Animals-1, 0266). This migration:
--
--   1. lifts that routing for animals (`listings_enforce_world_rules`: body of 0539, only the
--      routed-world list changes; medical and environment stay routed). An external body is still
--      accepted and validated when one is given;
--   2. gives animals four binding kinds: `adoption_offer` / `adoption_request` (handover) and
--      `foster_offer` / `foster_request` (boarding or pet-sitting, `care_mode`);
--   3. turns `worlds.feed_mirror` on for animals, so its open listings reach the main feed like
--      the other worlds (0522), and mirrors the ones that already exist. Knowledge stays unmirrored:
--      its listings wait for moderation (R-Knowledge-1) and the post tests rely on it staying out.
--
-- Members still need a verified identity to publish in animals (`worlds.requires_verification`,
-- 0264). Launch flags stay as they are (0441): they pick active vs portal, never the main feed.

begin;

-- ── 1. Animals are no longer a routed world ──────────────────────────────────────────
create or replace function public.listings_enforce_world_rules()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_kind_slug text;
  v_max_rides numeric;
  v_cost numeric;
  v_active_money int;
  v_min_age int := 18;
  v_birth date;
begin
  if new.origin <> 'native' then
    return new;
  end if;

  select lk.slug into v_kind_slug from public.listing_kinds lk where lk.kind_id = new.kind_id;

  if exists (
    select 1 from public.users u
     where u.user_id = new.owner_id and u.food_posting_banned_until > now()
  ) and new.world_slug = 'food' then
    raise exception 'food_posting_banned' using errcode = '42501';
  end if;

  -- D28: a food offer carries the giver's expiry. D21: a food request has none.
  if new.world_slug = 'food' and new.direction = 'give' and new.expires_at is null then
    raise exception 'food_expiry_required' using errcode = '23514';
  end if;

  if new.world_slug = 'items' then
    -- items_image_required moved to the deferred constraint triggers in 0351
    -- (accepts details image fields OR an attached listing_media photo).
    if tg_op = 'INSERT' and new.expires_at is null then
      new.expires_at := now() + interval '30 days';
    end if;
  end if;

  if new.world_slug = 'rides' then
    v_cost := nullif(new.details->>'cost_share_ils', '')::numeric;
    if v_cost is not null then
      select (param_value #>> '{}')::numeric into v_max_rides
        from public.marketplace_rule_params
       where rule_code = case when new.direction = 'give' then 'R-Rides-1' else 'R-Rides-2' end
         and param_key = 'max_cost_share_ils';
      if v_max_rides is not null and v_cost > v_max_rides then
        raise exception 'ride_cost_share_cap_exceeded' using errcode = '23514';
      end if;
    end if;
  end if;

  -- Medical and environment listings go through a verified external body. Animals do not (0612).
  if new.world_slug in ('medical','environment') and new.external_body_id is null then
    raise exception 'routed_world_requires_external_body' using errcode = '23514';
  end if;

  if new.world_slug = 'knowledge' and tg_op = 'INSERT' then
    new.moderation_status := 'pending_review';
  end if;

  if new.world_slug = 'money' and new.status = 'open' then
    select count(*) into v_active_money
      from public.listings l
     where l.owner_id = new.owner_id
       and l.world_slug = 'money'
       and l.status = 'open'
       and l.listing_id is distinct from new.listing_id;
    if v_active_money >= 5 then
      raise exception 'money_active_campaign_cap' using errcode = '23514';
    end if;
  end if;

  if new.world_slug = 'romantic_matchmaking' then
    v_birth := nullif(new.details->>'birth_date', '')::date;
    if v_birth is not null and age(v_birth) < (v_min_age || ' years')::interval then
      raise exception 'matchmaking_min_age' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

update public.marketplace_rules
   set label_en = 'Animals: direct give and take (external-body routing lifted, 0612)'
 where rule_code = 'R-Animals-1';

-- ── 2. Binding animals kinds ─────────────────────────────────────────────────────────
insert into public.listing_kinds (world_slug, slug, label_he, label_en, direction, detail_schema, sort_order)
values
  ('animals', 'adoption_offer', 'מסירת בעל חיים', 'Animal to give away', 'give', $schema$
{
  "type": "object",
  "additionalProperties": false,
  "required": ["species"],
  "properties": {
    "species": {"enum": ["dog", "cat", "rabbit", "bird", "rodent", "reptile", "other"]},
    "age_group": {"enum": ["young", "adult", "senior"]},
    "sex": {"enum": ["male", "female"]},
    "size": {"enum": ["small", "medium", "large"]},
    "vaccinated": {"type": "boolean"},
    "neutered": {"type": "boolean"},
    "good_with": {"type": "array", "items": {"enum": ["children", "dogs", "cats"]}}
  }
}
$schema$::jsonb, 1),
  ('animals', 'adoption_request', 'מחפש/ת לאמץ', 'Looking to adopt', 'request', $schema$
{
  "type": "object",
  "additionalProperties": false,
  "required": ["species"],
  "properties": {
    "species": {"enum": ["dog", "cat", "rabbit", "bird", "rodent", "reptile", "other"]},
    "age_group": {"enum": ["young", "adult", "senior"]},
    "size": {"enum": ["small", "medium", "large"]}
  }
}
$schema$::jsonb, 2),
  ('animals', 'foster_offer', 'פנסיון / שמירה על בעל חיים', 'Boarding or pet-sitting offer', 'give', $schema$
{
  "type": "object",
  "additionalProperties": false,
  "required": ["species", "care_mode"],
  "properties": {
    "species": {"enum": ["dog", "cat", "rabbit", "bird", "rodent", "reptile", "other"]},
    "care_mode": {"enum": ["full_boarding", "part_time", "pet_sitting"]},
    "location_mode": {"enum": ["my_home", "owner_home", "either"]},
    "duration_days": {"type": "integer", "minimum": 1, "maximum": 90}
  }
}
$schema$::jsonb, 3),
  ('animals', 'foster_request', 'מחפש/ת פנסיון / שמירה', 'Looking for boarding or pet-sitting', 'request', $schema$
{
  "type": "object",
  "additionalProperties": false,
  "required": ["species", "care_mode"],
  "properties": {
    "species": {"enum": ["dog", "cat", "rabbit", "bird", "rodent", "reptile", "other"]},
    "care_mode": {"enum": ["full_boarding", "part_time", "pet_sitting"]},
    "location_mode": {"enum": ["my_home", "owner_home", "either"]},
    "starts_on": {"type": "string", "format": "date"},
    "ends_on": {"type": "string", "format": "date"}
  }
}
$schema$::jsonb, 4)
on conflict (world_slug, slug) do update
  set label_he = excluded.label_he, label_en = excluded.label_en, direction = excluded.direction,
      detail_schema = excluded.detail_schema, sort_order = excluded.sort_order, is_active = true;

-- ── 3. Animals reach the main feed ───────────────────────────────────────────────────
update public.worlds
   set feed_mirror = true
 where slug = 'animals';

-- One failing listing is reported and skipped; it never blocks the others or the deploy.
do $$
declare
  r public.listings%rowtype;
begin
  for r in
    select l.*
      from public.listings l
     where l.world_slug = 'animals'
       and l.origin = 'native'
       and l.status = 'open'
       and l.moderation_status = 'published'
       and not exists (select 1 from public.posts p where p.listing_id = l.listing_id)
     order by l.created_at
  loop
    begin
      perform public.listing_feed_mirror_upsert(r);
    exception when others then
      raise warning 'animals_world_direct backfill: listing % skipped: %', r.listing_id, sqlerrm;
    end;
  end loop;
end $$;

commit;
