-- KC#1128 — let the ride owner finish the ride once, close its offer, and settle
-- every approved booking through the existing handoff karma and notification paths.
begin;

create or replace function public.complete_ride_listing(p_listing_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_listing public.listings;
  v_departs timestamptz;
  v_completed integer := 0;
  v_h public.giving_handoffs;
begin
  if v_uid is null then raise exception 'auth_required' using errcode = '42501'; end if;
  select * into v_listing from public.listings
   where listing_id = p_listing_id and world_slug = 'rides' and direction = 'give'
   for update;
  if not found then raise exception 'listing_not_available' using errcode = 'P0002'; end if;
  if v_listing.owner_id <> v_uid then raise exception 'owner_only' using errcode = '42501'; end if;
  if v_listing.status <> 'open' then raise exception 'invalid_status' using errcode = '23514'; end if;

  v_departs := nullif(v_listing.details->>'departs_at', '')::timestamptz;
  if v_departs is not null and v_departs > now() + interval '1 hour' then
    raise exception 'ride_not_started' using errcode = '23514';
  end if;

  for v_h in
    update public.giving_handoffs
       set status = 'handed_over', handed_over_at = now(), confirmed_at = coalesce(confirmed_at, now())
     where listing_id = p_listing_id and world_slug = 'rides' and status = 'confirmed'
     returning *
  loop
    perform public.karma_award_handoff(v_h.owner_id, v_h.recipient_id, v_h.world_slug, v_h.handoff_id);
    v_completed := v_completed + 1;
  end loop;

  update public.giving_handoffs
     set status = 'cancelled', cancel_reason = 'system'
   where listing_id = p_listing_id and world_slug = 'rides' and status = 'reserved';

  update public.listings set status = 'closed', updated_at = now()
   where listing_id = p_listing_id;
  return v_completed;
end;
$$;

revoke all on function public.complete_ride_listing(uuid) from public, anon, authenticated;
grant execute on function public.complete_ride_listing(uuid) to authenticated;
comment on function public.complete_ride_listing(uuid) is
  'Owner completes a ride offer: confirmed bookings become handed over and earn configured ride karma, waiting bookings are cancelled, and the listing closes. KC#1128.';

-- The detail payload must expose lifecycle status so the client can gate the
-- finish action using the same `open` condition as complete_ride_listing.
create or replace function public.get_marketplace_listing_detail(p_listing_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_viewer uuid := auth.uid();
  v_listing public.listings%rowtype;
  v_row public.marketplace_listing_card%rowtype;
  v_media jsonb;
  v_owner jsonb;
begin
  select * into v_listing from public.listings where listing_id = p_listing_id;
  if not found then return null; end if;
  if not public.is_listing_visible_to(v_listing, v_viewer) then return null; end if;

  select * into v_row from public.marketplace_listing_card c where c.listing_id = p_listing_id;
  select coalesce(jsonb_agg(jsonb_build_object('storage_path', m.storage_path, 'sort_order', m.sort_order)
    order by m.sort_order), '[]'::jsonb) into v_media
    from public.listing_media m where m.listing_id = p_listing_id;
  select jsonb_build_object('user_id', u.user_id, 'display_name', u.display_name,
    'avatar_url', u.avatar_url, 'share_handle', u.share_handle, 'city_id', u.city)
    into v_owner from public.users u where u.user_id = v_row.owner_id;

  return jsonb_build_object(
    'listing_id', v_row.listing_id, 'owner_id', v_row.owner_id,
    'world_slug', v_row.world_slug, 'world_label_en', v_row.world_label_en,
    'world_label_he', v_row.world_label_he, 'kind_slug', v_row.kind_slug,
    'kind_label_en', v_row.kind_label_en, 'kind_label_he', v_row.kind_label_he,
    'direction', v_row.direction, 'title', v_row.title, 'summary', v_row.summary,
    'details', v_row.details, 'city_id', v_row.city_id, 'urgency_level', v_row.urgency_level,
    'availability_status', v_row.availability_status, 'status', v_listing.status,
    'published_at', v_row.published_at,
    'geo', case when v_row.geo is null then null else extensions.st_asgeojson(v_row.geo)::jsonb end,
    'max_radius_km', (select l.max_radius_km_override from public.listings l where l.listing_id = p_listing_id),
    'media', v_media, 'owner', v_owner,
    'feed_post_id', (select p.post_id from public.posts p where p.listing_id = p_listing_id)
  );
end;
$$;

commit;
