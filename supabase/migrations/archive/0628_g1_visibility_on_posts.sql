-- 0628_g1_visibility_on_posts | G1 step 6a-5d (ADR-006, D-214, issues #1671, #1907): who sees a
-- listing is decided on its post, and a moderation hold no longer closes a post-owned listing.
--
--   1. post_listing_visible_to (new, internal)  whether a viewer sees the listing behind a post:
--      a post that owns its listing (items, and food / rides / housing / time since 0554) is seen
--      as the post is (is_post_visible_to); the mirror of a listing-sourced listing applies the
--      listing rules (0242 / 0468 / 0549) to the post's columns — status, visibility, and the
--      moderation_status that 0626 carries. A reporter's hide of the listing or of the post hides it.
--   2. is_listing_visible_to (0549)  a listing-sourced listing that has a post now answers through
--      1. The post-owned branch (is_post_visible_to) and the v1 ride branch are unchanged; a listing
--      without a post yet (a knowledge listing awaiting moderation) still answers on its own
--      columns. Signature and grants unchanged, so the listings and listing_media RLS policies,
--      browse, search, matching and the detail RPC follow without a change of their own.
--      The mapping is exact while post and listing are in step (both syncs write on every change):
--      listing open / closed = post open / closed_delivered, anonymity 3 / 2 / 1 = visibility
--      Public / FollowersOnly / OnlyMe, moderation_status copied. One addition: a reporter of the
--      mirror post no longer sees the listing either.
--   3. listing_upsert_from_post (0626), #1907  a moderation hold on a post-owned listing folds the
--      post's status to deleted_no_recipient (post_sync_from_listing / listing_feed_mirror_status,
--      0551), which hides it everywhere — the ride readers of 0623 / 0624 take post status 'open'
--      to mean open and published. Until now that folded status was then pushed back to the
--      listing as 'closed', so publishing again left the listing closed and the post
--      closed_delivered. While the post is held (posts.moderation_status, 0626) the listing now
--      keeps its own status, and publishing again restores the post to it.
-- Bodies are the latest definitions copied verbatim; changed lines carry `-- 0628`. Names,
-- arguments, return types and grants are unchanged. Listings already closed by #1907 are not
-- reopened here (an owner's close cannot be told apart from it after the fact).

begin;

-- ── 1. Whether a viewer sees the listing behind a post ──────────────────────────────────────────
create or replace function public.post_listing_visible_to(p_post public.posts, p_viewer uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_post.owner_id = p_viewer then
    return true;
  end if;
  if public.is_account_pending_deletion(p_post.owner_id) then
    return false;
  end if;
  -- A reporter's hide of the listing (0468) or of its post (FR-MOD-001 AC1).
  if exists (
    select 1 from public.reporter_hides h
     where h.reporter_id = p_viewer
       and ((h.target_type = 'listing' and h.target_id = p_post.legacy_listing_id)
         or (h.target_type = 'post' and h.target_id = p_post.post_id))
  ) then
    return false;
  end if;

  -- A post that owns its listing is the listing's record: seen as the post is.
  if public.post_owns_listing(p_post) then
    return public.is_post_visible_to(p_post, p_viewer);
  end if;

  -- The mirror of a listing-sourced listing: the listing rules (0242, 0549) on the post's columns.
  if p_post.moderation_status <> 'published' then
    return false;
  end if;
  if p_post.status not in ('open', 'closed_delivered') then -- listing 'open' / 'closed'
    return false;
  end if;
  if public.is_blocked(p_viewer, p_post.owner_id) then
    return false;
  end if;
  case p_post.visibility
    when 'Public' then        -- anonymity 3: an open listing; a closed one only to its owner (above)
      return p_post.status = 'open';
    when 'FollowersOnly' then -- anonymity 2
      return p_post.status = 'open' and public.is_following(p_viewer, p_post.owner_id);
    when 'OnlyMe' then        -- anonymity 1: operators only
      return public.is_listing_operator(p_viewer);
    else
      return false;
  end case;
end;
$$;

comment on function public.post_listing_visible_to(public.posts, uuid) is
  'G1 (0628): whether p_viewer sees the listing behind post p_post — as the post is when it owns its listing, else the listing rules on the post''s columns (moderation_status, status, visibility); a reporter''s hide of the listing or the post hides it.';

revoke all on function public.post_listing_visible_to(public.posts, uuid) from public, anon, authenticated;
grant execute on function public.post_listing_visible_to(public.posts, uuid) to service_role;

-- ── 2. is_listing_visible_to (0549): a listing-sourced listing with a post asks the post ────────
create or replace function public.is_listing_visible_to(p_listing listings, p_viewer uuid)
returns boolean
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_post public.posts;
  v_ride public.ride_listings;
begin
  if p_listing.owner_id = p_viewer then
    return true;
  end if;

  if public.is_account_pending_deletion(p_listing.owner_id) then
    return false;
  end if;

  -- KC#1298: a listing the viewer reported stays hidden from them (FR-MOD-001 AC1).
  if exists (
    select 1 from public.reporter_hides h
     where h.reporter_id = p_viewer
       and h.target_type = 'listing'
       and h.target_id   = p_listing.listing_id
  ) then
    return false;
  end if;

  if p_listing.legacy_post_id is not null then
    select * into v_post from public.posts where post_id = p_listing.legacy_post_id;
    if not found then
      return false;
    end if;
    return public.is_post_visible_to(v_post, p_viewer);
  end if;

  if p_listing.legacy_ride_id is not null then
    select * into v_ride from public.ride_listings where ride_id = p_listing.legacy_ride_id;
    if not found then
      return false;
    end if;
    if v_ride.owner_id = p_viewer then
      return true;
    end if;
    if public.is_blocked(p_viewer, v_ride.owner_id) then
      return false;
    end if;
    if v_ride.status <> 'open' then
      return false;
    end if;
    return v_ride.visibility = 'Public'
      or (v_ride.visibility = 'FollowersOnly' and public.is_following(p_viewer, v_ride.owner_id));
  end if;

  -- 0628: a listing-sourced listing with a post is seen as its post says (post_listing_visible_to);
  -- 0628: the listing's own columns below answer only for a listing that has no post yet.
  select * into v_post from public.posts where listing_id = p_listing.listing_id; -- 0628
  if found then                                                                  -- 0628
    return public.post_listing_visible_to(v_post, p_viewer);                     -- 0628
  end if;                                                                        -- 0628

  if p_listing.moderation_status <> 'published' then
    return false;
  end if;

  if p_listing.status not in ('open', 'closed') then
    return false;
  end if;

  if public.is_blocked(p_viewer, p_listing.owner_id) then
    return false;
  end if;

  case p_listing.anonymity_level
    when 3 then
      return p_listing.status = 'open'
        or (p_listing.status = 'closed' and p_listing.owner_id = p_viewer);
    when 2 then
      return p_listing.status = 'open'
        and public.is_following(p_viewer, p_listing.owner_id);
    when 1 then
      return public.is_listing_operator(p_viewer);
    else
      return false;
  end case;
end;
$$;

-- 0242 grants, restated so this file is self-contained.
revoke all on function public.is_listing_visible_to(public.listings, uuid) from public;
grant execute on function public.is_listing_visible_to(public.listings, uuid) to anon, authenticated, service_role;

-- ── 3. listing_upsert_from_post (0626): a moderation hold keeps the listing's status (#1907) ────
create or replace function public.listing_upsert_from_post(p_post public.posts)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_world       text := coalesce(p_post.world_slug, 'items');
  v_direction   text := coalesce(p_post.direction, case when p_post.type = 'Request' then 'request' else 'offer' end);
  v_kind_id     uuid := public.listing_kind_for_post(v_world, v_direction);
  v_is_items    boolean := v_world = 'items';
  v_status      text := public.listing_status_for_post(p_post.status);
  v_category_id uuid;
  v_geo         extensions.geography;
  v_details     jsonb;
  v_time_window tstzrange;
  v_expires_at  timestamptz;
  v_listing_id  uuid;
begin
  if v_kind_id is null or not public.post_owns_listing(p_post) then
    return;
  end if;

  if v_is_items then
    select category_id into v_category_id
      from public.categories
     where world_slug = 'items' and legacy_post_category = p_post.category
     order by sort_order limit 1;
    v_geo := coalesce(p_post.geo, public.listing_geo_from_city(p_post.city));
    v_details := jsonb_strip_nulls(jsonb_build_object(
      'item_condition', p_post.item_condition,
      'urgency', p_post.urgency,
      'street', p_post.street,
      'street_number', p_post.street_number,
      'location_display_level', p_post.location_display_level));
    v_time_window := case when p_post.delete_after is not null
      then tstzrange(p_post.created_at, p_post.delete_after, '[)') end;
    v_expires_at := p_post.delete_after;
  else
    v_category_id := p_post.category_id;
    v_geo := coalesce(p_post.geo, public.listing_geo_from_city(p_post.city));
    v_details := coalesce(p_post.details, '{}'::jsonb);
    v_time_window := p_post.time_window;
    v_expires_at := p_post.expires_at;
  end if;

  -- Update in place when the listing exists; an INSERT … ON CONFLICT would run the listing's
  -- BEFORE INSERT triggers (world TTL, expiry from details, rate limit) on every sync and feed
  -- their result into `excluded`, resetting what the listing side had set since.
  select l.listing_id into v_listing_id from public.listings l where l.legacy_post_id = p_post.post_id;

  -- 0628: a moderation hold folds the post's status to deleted_no_recipient (post_sync_from_listing);
  -- 0628: that is not the owner closing it, so the listing keeps its own status and publishing
  -- 0628: again restores both (#1907). Items posts are closed on the post engine and never held.
  if v_listing_id is not null and not v_is_items                                   -- 0628
     and p_post.moderation_status <> 'published' and p_post.status = 'deleted_no_recipient' then -- 0628
    select l.status into v_status from public.listings l where l.listing_id = v_listing_id; -- 0628
  end if;                                                                           -- 0628

  if v_listing_id is null then
    insert into public.listings (
      owner_id, world_slug, kind_id, category_id, direction, status, visibility,
      anonymity_level, title, summary, geo, city_id, time_window, expires_at,
      details, origin, legacy_post_id, moderation_status, published_at, created_at, updated_at,
      urgency_level, external_body_id, beneficiary_org_id,
      availability_status, max_radius_km_override -- 0626: the post's own values
    ) values (
      p_post.owner_id, v_world, v_kind_id, v_category_id,
      case when v_direction = 'request' then 'request' else 'give' end,
      v_status, p_post.visibility, public.visibility_to_anonymity_level(p_post.visibility),
      p_post.title, p_post.description, v_geo, p_post.city, v_time_window, v_expires_at,
      v_details, case when v_is_items then 'post' else 'native' end, p_post.post_id, 'published',
      coalesce(p_post.created_at, now()), coalesce(p_post.created_at, now()), coalesce(p_post.updated_at, now()),
      coalesce(p_post.urgency_level, 2), p_post.external_body_id, p_post.beneficiary_org_id,
      p_post.availability_status, p_post.max_radius_km_override -- 0626
    )
    returning listing_id into v_listing_id;
  else
    update public.listings l set
      owner_id           = p_post.owner_id,
      kind_id            = v_kind_id,
      category_id        = v_category_id,
      direction          = case when v_direction = 'request' then 'request' else 'give' end,
      status             = v_status,
      visibility         = p_post.visibility,
      anonymity_level    = public.visibility_to_anonymity_level(p_post.visibility),
      title              = p_post.title,
      summary            = p_post.description,
      geo                = v_geo,
      city_id            = p_post.city,
      time_window        = v_time_window,
      expires_at         = v_expires_at,
      details            = v_details,
      urgency_level      = coalesce(p_post.urgency_level, 2),
      external_body_id   = p_post.external_body_id,
      beneficiary_org_id = p_post.beneficiary_org_id,
      availability_status    = p_post.availability_status,    -- 0626
      max_radius_km_override = p_post.max_radius_km_override, -- 0626
      updated_at         = now()
    where l.listing_id = v_listing_id
      and (l.owner_id, l.kind_id, l.category_id, l.direction, l.status, l.visibility, l.anonymity_level,
           l.title, l.summary, l.geo::text, l.city_id, l.time_window, l.expires_at, l.details,
           l.urgency_level, l.external_body_id, l.beneficiary_org_id,
           l.availability_status, l.max_radius_km_override) -- 0626
          is distinct from
          (p_post.owner_id, v_kind_id, v_category_id,
           case when v_direction = 'request' then 'request' else 'give' end,
           v_status, p_post.visibility, public.visibility_to_anonymity_level(p_post.visibility),
           p_post.title, p_post.description, v_geo::text, p_post.city, v_time_window, v_expires_at,
           v_details, coalesce(p_post.urgency_level, 2), p_post.external_body_id, p_post.beneficiary_org_id,
           p_post.availability_status, p_post.max_radius_km_override); -- 0626
  end if;

  -- A post of a listing world points at its listing like a mirror does, so the feed card,
  -- the detail redirect and the photo sync keep working (0466, 0522).
  if not v_is_items then
    update public.posts
       set listing_id = v_listing_id, listing_world_slug = v_world
     where post_id = p_post.post_id
       and listing_id is null;
  end if;

  -- 0626: what the listing side sets (kind, publication, moderation) and the link come back to
  -- 0626: the post, items included (an items listing never syncs back through the mirror trigger).
  update public.posts p                                                                  -- 0626
     set kind_id = l.kind_id, legacy_listing_id = l.listing_id,                          -- 0626
         published_at = l.published_at, moderation_status = l.moderation_status          -- 0626
    from public.listings l                                                               -- 0626
   where l.listing_id = v_listing_id                                                     -- 0626
     and p.post_id = p_post.post_id                                                      -- 0626
     and (p.kind_id, p.legacy_listing_id, p.published_at, p.moderation_status)          -- 0626
         is distinct from (l.kind_id, l.listing_id, l.published_at, l.moderation_status); -- 0626
end;
$$;

revoke all on function public.listing_upsert_from_post(public.posts) from public, anon, authenticated;
grant execute on function public.listing_upsert_from_post(public.posts) to service_role;

commit;
