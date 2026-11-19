-- Production copy (FR-ADMIN-037) · posts and their world-specific rows.
--
-- Each element of the input array (already anonymized and cleaned, AC6–AC7):
--   { "id", "owner_id", "world_slug", "kind_slug", "item_subcategory_slug", "post_type",
--     "direction", "status", "title", "description", "details", "city_id", "time_window",
--     "urgency_level", "expires_at", "source_language", "published_at", "created_at",
--     "ride": {…} | null, "event": {…} | null, "food": {…} | null, "housing": {…} | null }
-- Catalog rows (post kinds, item subcategories) have different ids in every database, so a
-- post names them by slug. Cities share their official codes across databases.

-- Creates one copied post with its world-specific row. Raises when kc-dev refuses it (an
-- unknown kind, a ride already departed, …); the caller skips that post and counts why.
create or replace function kc_private.prod_copy_insert_post(p jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id constant uuid := (p ->> 'id')::uuid;
  v_kind_id uuid;
begin
  select k.id into v_kind_id
    from public.post_kinds k
   where k.world_slug = p ->> 'world_slug' and k.slug = p ->> 'kind_slug';
  if v_kind_id is null then
    raise exception 'prod_copy_unknown_kind' using errcode = 'P0001';
  end if;

  -- AC4: no street, number or point is copied, so every copied post shows its city only.
  insert into public.posts (id, owner_id, world_slug, kind_id, post_type, direction, status, visibility,
                            title, description, item_subcategory_id, details, city_id,
                            location_display_level, time_window, urgency_level, expires_at,
                            source_language, published_at, created_at)
  select v_id, (p ->> 'owner_id')::uuid, p ->> 'world_slug', v_kind_id, p ->> 'post_type',
         p ->> 'direction', p ->> 'status', 'Public', p ->> 'title', p ->> 'description',
         (select c.id from public.item_subcategories c
           where c.world_slug = p ->> 'world_slug' and c.slug = p ->> 'item_subcategory_slug'),
         coalesce(p -> 'details', '{}'::jsonb), p ->> 'city_id', 'CityOnly',
         (p ->> 'time_window')::tstzrange, (p ->> 'urgency_level')::smallint,
         (p ->> 'expires_at')::timestamptz, p ->> 'source_language',
         (p ->> 'published_at')::timestamptz, coalesce((p ->> 'created_at')::timestamptz, now());

  -- Cities only: kc-dev's ride trigger places both ends on their city (AC4).
  if jsonb_typeof(p -> 'ride') = 'object' then
    insert into public.post_ride_details (post_id, origin_city_id, dest_city_id, departs_at, arrives_at,
                                          seats, luggage, cargo_items, cargo_food, reward_model,
                                          cost_share_ils, notes)
    select v_id, r ->> 'origin_city_id', r ->> 'dest_city_id', (r ->> 'departs_at')::timestamptz,
           (r ->> 'arrives_at')::timestamptz, (r ->> 'seats')::smallint,
           coalesce((r ->> 'luggage')::boolean, false), coalesce((r ->> 'cargo_items')::boolean, false),
           coalesce((r ->> 'cargo_food')::boolean, false), r ->> 'reward_model',
           (r ->> 'cost_share_ils')::numeric, r ->> 'notes'
      from (select p -> 'ride' as r) x;
  end if;

  -- The event's address is not copied (AC4).
  if jsonb_typeof(p -> 'event') = 'object' then
    insert into public.post_event_details (post_id, starts_at, ends_at, capacity, registration_policy,
                                           counts_volunteer_hours)
    select v_id, (e ->> 'starts_at')::timestamptz, (e ->> 'ends_at')::timestamptz,
           (e ->> 'capacity')::integer, e ->> 'registration_policy',
           coalesce((e ->> 'counts_volunteer_hours')::boolean, false)
      from (select p -> 'event' as e) x;
  end if;

  if jsonb_typeof(p -> 'food') = 'object' then
    insert into public.post_food_details (post_id, expires_at, food_type, allergens, kosher, dietary_tags)
    select v_id, (f ->> 'expires_at')::timestamptz, f ->> 'food_type',
           coalesce(array(select jsonb_array_elements_text(f -> 'allergens')), '{}'),
           (f ->> 'kosher')::boolean,
           coalesce(array(select jsonb_array_elements_text(f -> 'dietary_tags')), '{}')
      from (select p -> 'food' as f) x;
  end if;

  if jsonb_typeof(p -> 'housing') = 'object' then
    insert into public.post_housing_details (post_id, place_type, capacity, exclusive, min_nights, max_nights,
                                             check_in_from, check_in_until, check_out_by, children_ok,
                                             pets_ok, available_from, available_until, available_weekdays,
                                             blackout_dates)
    select v_id, h ->> 'place_type', (h ->> 'capacity')::smallint, (h ->> 'exclusive')::boolean,
           (h ->> 'min_nights')::smallint, (h ->> 'max_nights')::smallint,
           (h ->> 'check_in_from')::time, (h ->> 'check_in_until')::time, (h ->> 'check_out_by')::time,
           (h ->> 'children_ok')::boolean, (h ->> 'pets_ok')::boolean,
           (h ->> 'available_from')::date, (h ->> 'available_until')::date,
           (h ->> 'available_weekdays')::smallint,
           coalesce(array(select jsonb_array_elements_text(h -> 'blackout_dates')::date), '{}')
      from (select p -> 'housing' as h) x;
  end if;
end;
$$;
comment on function kc_private.prod_copy_insert_post(jsonb) is
  'FR-ADMIN-037: creates one copied post with its ride, event, food or housing row.';

-- Adds new posts, replaces posts whose copied fields changed and deletes copied posts no longer
-- in the copy (AC8). A post kc-dev refuses is skipped, never failing the whole copy; the result
-- counts the skips by reason (error text only, never post data, AC10).
-- Returns {posts, posts_created, posts_deleted, posts_skipped, posts_skipped_by_reason}.
create or replace function kc_private.prod_copy_sync_posts(p_posts jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_members constant uuid[] := kc_private.prod_copy_member_ids();
  v_post record;
  v_created integer := 0;
  v_deleted integer;
  v_skips jsonb := '{}'::jsonb;
  v_reason text;
begin
  if to_regclass('pg_temp.pc_post') is not null then drop table pg_temp.pc_post; end if;
  -- The hash covers every copied field, so any change in production replaces the post.
  -- A post whose owner is not a copied member is ignored: the copy writes only its own data.
  create temporary table pc_post on commit drop as
  select (e ->> 'id')::uuid as id, md5(e::text) as content_hash, e as data
    from jsonb_array_elements(p_posts) e
   where (e ->> 'owner_id')::uuid = any (v_members);

  delete from public.posts p
   where p.owner_id = any (v_members)
     and not exists (select 1 from pg_temp.pc_post n
                       join kc_private.prod_copy_posts c on c.post_id = n.id
                      where n.id = p.id and c.content_hash = n.content_hash);
  get diagnostics v_deleted = row_count;

  -- World declarations the posts need: a ride offer needs the driver declaration and a stay
  -- offer the hosting conduct (kc-dev refuses them otherwise). Production accepted the same.
  insert into public.user_consents (user_id, consent_kind, version, locale)
  select distinct (n.data ->> 'owner_id')::uuid, d.kind, kc_private.world_consent_version(d.kind), 'he'
    from pg_temp.pc_post n
    join (values ('ride', 'driver_declaration'), ('housing_stay', 'housing_conduct')) d (post_type, kind)
      on d.post_type = n.data ->> 'post_type'
   where n.data ->> 'direction' = 'offer'
  on conflict (user_id, consent_kind, version) do nothing;

  for v_post in
    select n.* from pg_temp.pc_post n
     where not exists (select 1 from public.posts p where p.id = n.id)
     order by (n.data ->> 'created_at')
  loop
    begin
      perform kc_private.prod_copy_insert_post(v_post.data);
      insert into kc_private.prod_copy_posts (post_id, content_hash)
      values (v_post.id, v_post.content_hash)
      on conflict (post_id) do update set content_hash = excluded.content_hash;
      v_created := v_created + 1;
    exception when others then
      v_reason := case sqlstate when 'P0001' then sqlerrm else 'sqlstate_' || sqlstate end;
      v_skips := jsonb_set(v_skips, array[v_reason], to_jsonb(coalesce((v_skips ->> v_reason)::integer, 0) + 1));
    end;
  end loop;

  return jsonb_build_object(
    'posts', (select count(*) from public.posts p where p.owner_id = any (v_members)),
    'posts_created', v_created, 'posts_deleted', v_deleted,
    'posts_skipped', (select coalesce(sum(value::integer), 0) from jsonb_each_text(v_skips)),
    'posts_skipped_by_reason', v_skips);
end;
$$;
comment on function kc_private.prod_copy_sync_posts(jsonb) is
  'FR-ADMIN-037: adds, replaces and removes copied posts; skips (and counts) what kc-dev refuses.';
