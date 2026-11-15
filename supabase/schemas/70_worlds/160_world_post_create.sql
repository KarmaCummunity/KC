-- Worlds · creating a post together with its detail row
--
-- A ride, a stay offer, an event and a food offer are only meaningful with their detail
-- row, so the two are created in one call and one transaction (quick publish, D75): the
-- post is inserted as a draft, the details are checked by their table, and only then is
-- the post published — route alerts and every other consequence of publishing see a
-- complete post. One RPC for the four worlds rather than one per world: the post part is
-- identical, and each world's rules live in its detail table, not in the RPC. Later edits
-- need no RPC: the owner updates `posts` and the detail table directly, under their grants.
-- Worlds without a detail table keep using a plain insert into `posts`.

-- Inserts the post of p_owner_id from p_post (the columns a device may set on `posts`),
-- its detail row from p_details, and publishes it in p_publish_role (`owner`, or `system`
-- for a scheduled occurrence); null leaves a draft. Returns the post id.
--   post_details_not_supported  the post is not of a kind that has a detail table
create function kc_private.post_create(p_owner_id uuid, p_post jsonb, p_details jsonb, p_publish_role text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.posts;
begin
  insert into public.posts (
    owner_id, world_slug, kind_id, post_type, direction, status, visibility, title, description,
    item_subcategory_id, details, city_id, location_display_level, urgency_level)
  select p_owner_id, r.world_slug, r.kind_id, coalesce(r.post_type, 'standard'), r.direction, 'draft',
         coalesce(r.visibility, 'Public'), r.title, r.description, r.item_subcategory_id,
         coalesce(r.details, '{}'::jsonb), r.city_id,
         coalesce(r.location_display_level, 'CityAndStreet'), r.urgency_level
    from jsonb_populate_record(null::public.posts, coalesce(p_post, '{}'::jsonb)) r
  returning * into v_post;

  if v_post.post_type = 'ride' then
    insert into public.post_ride_details (
      post_id, origin_city_id, origin_street_id, origin_junction_id, dest_city_id, dest_street_id,
      dest_junction_id, meeting_points, departs_at, arrives_at, seats, luggage, cargo_items, cargo_food,
      reward_model, cost_share_ils, notes, series_id, series_on)
    select v_post.id, r.origin_city_id, r.origin_street_id, r.origin_junction_id, r.dest_city_id,
           r.dest_street_id, r.dest_junction_id, coalesce(r.meeting_points, '[]'::jsonb), r.departs_at,
           r.arrives_at, coalesce(r.seats, 1), coalesce(r.luggage, false), coalesce(r.cargo_items, false),
           coalesce(r.cargo_food, false), coalesce(r.reward_model, 'free'), r.cost_share_ils, r.notes,
           -- Only the scheduler links an occurrence to its series.
           case p_publish_role when 'system' then r.series_id end,
           case p_publish_role when 'system' then r.series_on end
      from jsonb_populate_record(null::public.post_ride_details, p_details) r;
  elsif v_post.post_type = 'housing_stay' then
    insert into public.post_housing_details (
      post_id, place_type, capacity, exclusive, min_nights, max_nights, check_in_from, check_in_until,
      check_out_by, children_ok, pets_ok, available_from, available_until, available_weekdays, blackout_dates)
    select v_post.id, r.place_type, r.capacity, coalesce(r.exclusive, false), coalesce(r.min_nights, 1),
           coalesce(r.max_nights, 3), coalesce(r.check_in_from, '16:00'), coalesce(r.check_in_until, '22:00'),
           coalesce(r.check_out_by, '10:00'), coalesce(r.children_ok, false), coalesce(r.pets_ok, false),
           r.available_from, r.available_until, r.available_weekdays, coalesce(r.blackout_dates, '{}')
      from jsonb_populate_record(null::public.post_housing_details, p_details) r;
  elsif v_post.post_type = 'event' then
    insert into public.post_event_details (
      post_id, starts_at, ends_at, capacity, registration_policy, address_label, counts_volunteer_hours)
    select v_post.id, r.starts_at, r.ends_at, r.capacity, coalesce(r.registration_policy, 'automatic'),
           r.address_label, coalesce(r.counts_volunteer_hours, false)
      from jsonb_populate_record(null::public.post_event_details, p_details) r;
  elsif v_post.post_type = 'standard' and v_post.world_slug = 'food' and v_post.direction = 'offer' then
    insert into public.post_food_details (post_id, expires_at, food_type, allergens, kosher, dietary_tags)
    select v_post.id, r.expires_at, r.food_type, coalesce(r.allergens, '{}'), r.kosher,
           coalesce(r.dietary_tags, '{}')
      from jsonb_populate_record(null::public.post_food_details, p_details) r;
  else
    raise exception 'post_details_not_supported' using errcode = 'P0001';
  end if;

  if p_publish_role is not null then
    perform kc_private.post_move(v_post.id, 'open', p_publish_role);
  end if;
  return v_post.id;
end;
$$;
comment on function kc_private.post_create(uuid, jsonb, jsonb, text) is
  'Creates a post with its ride, stay, event or food details in one transaction and optionally publishes it.';

-- Creates the caller's ride, stay offer, event or food offer.
--   p_post     world_slug, kind_id, post_type ('ride' | 'housing_stay' | 'event', or absent
--              for a food offer), direction, title, city_id and optionally description,
--              visibility, item_subcategory_id, details, location_display_level,
--              urgency_level; "status": "draft" keeps the post unpublished
--   p_details  the columns of the world's detail table
-- Errors: whatever the post and the detail table refuse — post_kind_not_allowed,
-- post_limit_exceeded, post_details_not_supported, ride_place_invalid, declaration_required,
-- verification_required, food_expiry_required, … — plus SQLSTATE 23xxx / 22xxx for a
-- missing or malformed field.
create function public.create_post_with_details(p_post jsonb, p_details jsonb)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select kc_private.post_create(
    kc_private.require_active_caller(), p_post, p_details,
    case when p_post ->> 'status' = 'draft' then null else 'owner' end);
$$;
comment on function public.create_post_with_details(jsonb, jsonb) is
  'Creates and publishes (or drafts) the caller''s ride, stay offer, event or food offer with its details.';
grant execute on function public.create_post_with_details(jsonb, jsonb) to authenticated;

-- A post of a kind that has a detail table never exists without its row. Checked at
-- commit, so the post and its details can be written in either order inside one
-- transaction; a bare insert of such a post from a device fails (post_details_required).
create function kc_private.posts_require_details()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.posts p where p.id = new.id)
     and not (case
       when new.post_type = 'ride' then
         exists (select 1 from public.post_ride_details d where d.post_id = new.id)
       when new.post_type = 'housing_stay' then
         exists (select 1 from public.post_housing_details d where d.post_id = new.id)
       when new.post_type = 'event' then
         exists (select 1 from public.post_event_details d where d.post_id = new.id)
       else
         exists (select 1 from public.post_food_details d where d.post_id = new.id)
     end) then
    raise exception 'post_details_required' using errcode = 'P0001';
  end if;
  return null;
end;
$$;
comment on function kc_private.posts_require_details() is
  'Deferred check: a ride, stay, event or food offer post has its detail row when the transaction commits.';

create constraint trigger posts_require_details
  after insert on public.posts
  deferrable initially deferred
  for each row
  when (new.post_type in ('ride', 'housing_stay', 'event')
        or (new.post_type = 'standard' and new.world_slug = 'food' and new.direction = 'offer'))
  execute function kc_private.posts_require_details();
