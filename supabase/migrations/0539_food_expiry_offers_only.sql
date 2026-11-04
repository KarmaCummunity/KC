-- 0539_food_expiry_offers_only | Food expiry as specified: an offer carries the giver's
-- expiry (D28), a request has none (D21). docs/spec/05_giving_worlds.md §5.1,
-- docs/spec/07_cross_cutting_systems.md §7.1 (expiry by type).
--
-- 1. No world TTL for food. `listings_before_write` (0459) filled a missing expiry with the
--    food TTL (168 h) before `listings_enforce_world_rules` ran, so `food_expiry_required`
--    never fired: an offer without the giver's expiry was published with a 7-day one, and
--    every food request expired after 7 days and was closed by the hourly sweep.
-- 2. `listings_enforce_world_rules`: `food_expiry_required` binds offers only (body of 0351,
--    the latest definition; only that condition changes). The app mirrors it in
--    `@kc/domain` `validateMarketplaceWorldRules`.
-- 3. Open native food requests drop the expiry the TTL gave them, so the sweep (0467) never
--    closes them. Requests whose details carry an expiry of their own are left alone.
--
-- Items and rides TTLs are unchanged. Idempotent.

begin;

-- 1. Food has no default lifetime: an offer's comes from the giver, a request has none.
update public.worlds set default_ttl_hours = null where slug = 'food';
update public.listing_kinds set default_ttl_hours = null where world_slug = 'food';

-- 2. The expiry rule binds food offers only.
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

  if new.world_slug in ('medical','animals','environment') and new.external_body_id is null then
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

-- 3. Open food requests stop expiring (their expiry came from the TTL, not the requester).
update public.listings
   set expires_at = null
 where world_slug = 'food'
   and direction = 'request'
   and origin = 'native'
   and status = 'open'
   and expires_at is not null
   and public.listing_details_expires_at(details) is null;

commit;
