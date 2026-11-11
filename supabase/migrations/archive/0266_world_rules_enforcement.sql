-- 0266_world_rules_enforcement | Issue #849 (part 2)
-- Triggers enforcing PRD V2 per-world rules on native listings.

begin;

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

  if new.world_slug = 'food' and new.expires_at is null then
    raise exception 'food_expiry_required' using errcode = '23514';
  end if;

  if new.world_slug = 'items' then
    if coalesce(new.details->>'image_url', new.details->>'image_path') is null then
      raise exception 'items_image_required' using errcode = '23514';
    end if;
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

drop trigger if exists listings_enforce_world_rules on public.listings;
create trigger listings_enforce_world_rules
  before insert or update on public.listings
  for each row execute function public.listings_enforce_world_rules();

create or replace function public.listings_food_expiry_block()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.world_slug = 'food' and new.expires_at is not null and new.expires_at <= now() then
    new.status := 'expired';
  end if;
  return new;
end;
$$;

drop trigger if exists listings_food_expiry_block on public.listings;
create trigger listings_food_expiry_block
  before insert or update of expires_at on public.listings
  for each row execute function public.listings_food_expiry_block();

commit;
