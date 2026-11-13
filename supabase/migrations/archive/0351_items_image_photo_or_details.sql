-- 0351_items_image_photo_or_details | follow-up to #950 / #952
-- Bug: native items listings could never be created.
--   * 0266 checked details->>'image_url'/'image_path' in a BEFORE INSERT trigger, but
--   * 0321 set additionalProperties:false on the items detail schemas, which have no
--     image fields, so putting an image in details was rejected, and
--   * create_marketplace_listing(..., p_media_paths) attaches photos to listing_media
--     only AFTER the listing row is inserted, so the BEFORE check never saw them.
-- Fix:
--   1. Drop the items image check from listings_enforce_world_rules (rest unchanged).
--   2. Enforce it with DEFERRABLE INITIALLY DEFERRED constraint triggers checked at commit.
--      Pass if details has image_url/image_path OR at least one listing_media row.
--      create_marketplace_listing inserts the listing and its photos in one transaction
--      (single RPC call), so its signature is unchanged.
--      Fires on native items INSERT, on UPDATE when world/kind/details/origin change
--      (status-only updates stay exempt, as in 0350), and when photos are deleted.
--   3. Allow image_url/image_path strings in the items detail schemas (back-compat).

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

create or replace function public.listings_items_image_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing_id uuid;
  v_row public.listings%rowtype;
begin
  v_listing_id := case when tg_table_name = 'listing_media' then old.listing_id else new.listing_id end;

  -- Re-read the row as of commit: it may have been changed or deleted later in the tx.
  select * into v_row from public.listings where listing_id = v_listing_id;
  if not found or v_row.world_slug <> 'items' or v_row.origin <> 'native' then
    return null;
  end if;

  if coalesce(nullif(v_row.details->>'image_url', ''), nullif(v_row.details->>'image_path', '')) is not null then
    return null;
  end if;

  if exists (select 1 from public.listing_media m where m.listing_id = v_listing_id) then
    return null;
  end if;

  raise exception 'items_image_required' using errcode = '23514';
end;
$$;

revoke all on function public.listings_items_image_check() from public;

drop trigger if exists listings_items_image_required_ins on public.listings;
create constraint trigger listings_items_image_required_ins
  after insert on public.listings
  deferrable initially deferred
  for each row
  when (new.world_slug = 'items' and new.origin = 'native')
  execute function public.listings_items_image_check();

drop trigger if exists listings_items_image_required_upd on public.listings;
create constraint trigger listings_items_image_required_upd
  after update on public.listings
  deferrable initially deferred
  for each row
  when (
    new.world_slug = 'items' and new.origin = 'native'
    and (   old.world_slug is distinct from new.world_slug
         or old.kind_id    is distinct from new.kind_id
         or old.details    is distinct from new.details
         or old.origin     is distinct from new.origin)
  )
  execute function public.listings_items_image_check();

drop trigger if exists listing_media_items_image_required_del on public.listing_media;
create constraint trigger listing_media_items_image_required_del
  after delete on public.listing_media
  deferrable initially deferred
  for each row
  execute function public.listings_items_image_check();

update public.listing_kinds
   set detail_schema = jsonb_set(
         detail_schema,
         '{properties}',
         coalesce(detail_schema->'properties', '{}'::jsonb)
           || '{"image_url":{"type":"string"},"image_path":{"type":"string"}}'::jsonb
       )
 where world_slug = 'items'
   and detail_schema->>'type' = 'object';

commit;
