-- 0652_listing_detail_owner_verification | FR-VERIFY-001 AC2 on listing (ride) post detail.
-- get_marketplace_listing_detail owner json lacked verification_level; PublisherCard always saw 0.

begin;

create or replace function public.get_marketplace_listing_detail(p_listing_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_viewer uuid := auth.uid();
  v_listing_id uuid := public.handoff_target_listing_id(p_listing_id);
  v_post_id uuid;
  v_listing public.listings%rowtype;
  v_row public.marketplace_listing_card%rowtype;
  v_post public.posts;
  v_status text;
  v_max_radius numeric;
  v_media jsonb;
  v_owner jsonb;
begin
  select * into v_listing from public.listings where listing_id = v_listing_id;
  if not found then return null; end if;
  if not public.is_listing_visible_to(v_listing, v_viewer) then return null; end if;

  v_post_id := public.post_id_of_listing(v_listing_id);
  v_status := v_listing.status;
  v_max_radius := v_listing.max_radius_km_override;
  if v_listing.origin = 'native' and v_listing.legacy_post_id is not null then
    select * into v_post from public.posts where post_id = v_listing.legacy_post_id;
  end if;
  if v_post.post_id is not null then
    select v_listing.listing_id, p.owner_id, p.world_slug, w.label_he, w.label_en,
           lk.kind_id, lk.slug, lk.label_he, lk.label_en, p.category_id,
           case when p.direction = 'request' then 'request' else 'give' end, v_listing.status,
           p.visibility, public.visibility_to_anonymity_level(p.visibility), v_listing.title,
           v_listing.summary, p.geo, v_listing.city_id, p.time_window, p.expires_at, p.details,
           v_listing.origin, p.post_id, null::uuid, p.urgency_level, p.availability_status,
           p.published_at, v_listing.created_at, v_listing.updated_at
      into v_row
      from public.posts p
      join public.worlds w on w.slug = p.world_slug
      join public.listing_kinds lk on lk.kind_id = coalesce(p.kind_id, v_listing.kind_id)
     where p.post_id = v_post.post_id;
    v_status := case when v_post.moderation_status <> 'published' then v_listing.status
                     else public.listing_status_for_post(v_post.status) end;
    v_max_radius := v_post.max_radius_km_override;
  else
    select * into v_row from public.marketplace_listing_card c where c.listing_id = v_listing_id;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('storage_path', m.storage_path, 'sort_order', m.sort_order)
    order by m.sort_order), '[]'::jsonb) into v_media
    from public.listing_media m where m.listing_id = v_listing_id;
  select jsonb_build_object(
      'user_id', u.user_id,
      'display_name', u.display_name,
      'avatar_url', u.avatar_url,
      'share_handle', u.share_handle,
      'city_id', u.city,
      'verification_level', u.verification_level
    )
    into v_owner from public.users u where u.user_id = v_row.owner_id;

  return jsonb_build_object(
    'listing_id', v_row.listing_id, 'owner_id', v_row.owner_id,
    'world_slug', v_row.world_slug, 'world_label_en', v_row.world_label_en,
    'world_label_he', v_row.world_label_he, 'kind_slug', v_row.kind_slug,
    'kind_label_en', v_row.kind_label_en, 'kind_label_he', v_row.kind_label_he,
    'direction', v_row.direction, 'title', v_row.title, 'summary', v_row.summary,
    'details', v_row.details, 'city_id', v_row.city_id, 'urgency_level', v_row.urgency_level,
    'availability_status', v_row.availability_status, 'status', v_status,
    'published_at', v_row.published_at,
    'geo', case when v_row.geo is null then null else extensions.st_asgeojson(v_row.geo)::jsonb end,
    'max_radius_km', v_max_radius,
    'media', v_media, 'owner', v_owner,
    'feed_post_id', v_post_id,
    'feed_hidden', coalesce((select p.feed_hidden from public.posts p where p.post_id = v_post_id), false)
  );
end;
$$;

revoke all on function public.get_marketplace_listing_detail(uuid) from public;
grant execute on function public.get_marketplace_listing_detail(uuid) to anon, authenticated;

commit;
