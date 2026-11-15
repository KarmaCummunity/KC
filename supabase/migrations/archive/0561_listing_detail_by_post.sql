-- 0561_listing_detail_by_post.sql | G1 step 4b (ADR-006, D19): the listing detail opens by post
-- id, and an item made through the post form names its own post.
--
-- 4a made /post/[id] the detail screen of every listing-world post. An item made through the post
-- form owns its listing (0243: `listings.legacy_post_id`, `posts.listing_id` null), so the
-- listing detail answered `feed_post_id = null` for it and its reservation actions (reserve,
-- confirm, hand over, rate — on the derived listing) stayed on the listing screen only.
-- `get_marketplace_listing_detail` now resolves a post id or a listing id (0556) and names the
-- listing's post through `post_id_of_listing`, so the post screen can load the item's listing to
-- show those actions and the listing routes forward such an item to its post too. 0560 body;
-- signature, grants and the other keys unchanged. Additive.

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
  -- A post id (the one detail screen) or a listing id (the marketplace screens), 0556.
  v_listing_id uuid := public.handoff_target_listing_id(p_listing_id);
  v_post_id uuid;
  v_listing public.listings%rowtype;
  v_row public.marketplace_listing_card%rowtype;
  v_media jsonb;
  v_owner jsonb;
begin
  select * into v_listing from public.listings where listing_id = v_listing_id;
  if not found then return null; end if;
  if not public.is_listing_visible_to(v_listing, v_viewer) then return null; end if;

  v_post_id := public.post_id_of_listing(v_listing_id);
  select * into v_row from public.marketplace_listing_card c where c.listing_id = v_listing_id;
  select coalesce(jsonb_agg(jsonb_build_object('storage_path', m.storage_path, 'sort_order', m.sort_order)
    order by m.sort_order), '[]'::jsonb) into v_media
    from public.listing_media m where m.listing_id = v_listing_id;
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
    'max_radius_km', v_listing.max_radius_km_override,
    'media', v_media, 'owner', v_owner,
    -- The listing's post: its mirror (0466 / 0554) or, for an item made through the post form,
    -- the post it was derived from (0243).
    'feed_post_id', v_post_id,
    -- 0557: the post exists but the main feed does not list it yet (shared later, or its turn).
    'feed_hidden', coalesce((select p.feed_hidden from public.posts p where p.post_id = v_post_id), false)
  );
end;
$$;

revoke all on function public.get_marketplace_listing_detail(uuid) from public;
grant execute on function public.get_marketplace_listing_detail(uuid) to anon, authenticated;

commit;
