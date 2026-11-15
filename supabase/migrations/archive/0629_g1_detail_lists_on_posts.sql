-- 0629_g1_detail_lists_on_posts | G1 step 6a-5e (ADR-006, D-214, issue #1671): the listing detail
-- and the owner / profile lists read the post of a post-owned listing.
--
-- A post-owned listing (origin 'native' with legacy_post_id: food, rides, housing, time since 0554)
-- is derived from its post, and both syncs keep every field these readers return equal on the two
-- sides (title, description = summary, details, city, urgency, geo, availability, radius, kind,
-- publication, moderation; 0554 / 0626). For that shape the readers now take those fields from
-- `posts`; the status is the post's in the listing's words (listing_status_for_post) except during
-- a moderation hold, when the post's status is folded (0628) and the listing's own is returned.
-- Every other shape keeps reading the listing, because its post does not carry the listing's full
-- content yet: a mirror post's title is cut to 80 characters and its description and city fall back
-- to the details and the owner's city (0557), an items post keeps its fields in legacy columns
-- (details {}), and a listing awaiting moderation or a v1 ride has no post at all. Those readers
-- move once 6b gives posts content parity.
-- Title, summary and city stay the listing's for every shape: a listing that 0554's backfill made
-- post-owned keeps the mirror-era title (cut to 80) and fallback city on its post until the post is
-- next written, so the post is not yet their source (6b).
--   1. get_marketplace_listing_detail (0561)  same keys and values; the post-owned card is built
--      from the post, the world and the kind
--   2. list_my_listings (0413)  drives from the owner's listings as before — the keyset stays the
--      listing's (updated_at, listing_id), and listings without a post are included as before —
--      and takes the row's fields from the post where the post is the record
--   3. list_profile_listings (0338)  the same, with the post's visibility (post_listing_visible_to,
--      0628) and publication for a post-owned listing
-- Names, arguments, return shapes and grants are unchanged; changed lines carry `-- 0629`.

begin;

-- ── 1. The listing detail (0561) ────────────────────────────────────────────────────────────────
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
  v_post public.posts;      -- 0629
  v_status text;            -- 0629
  v_max_radius numeric;     -- 0629
  v_media jsonb;
  v_owner jsonb;
begin
  select * into v_listing from public.listings where listing_id = v_listing_id;
  if not found then return null; end if;
  if not public.is_listing_visible_to(v_listing, v_viewer) then return null; end if;

  v_post_id := public.post_id_of_listing(v_listing_id);
  v_status := v_listing.status;                          -- 0629
  v_max_radius := v_listing.max_radius_km_override;      -- 0629
  -- 0629: a post-owned listing reads its post, the record (same values by sync, 0554 / 0626).
  if v_listing.origin = 'native' and v_listing.legacy_post_id is not null then                   -- 0629
    select * into v_post from public.posts where post_id = v_listing.legacy_post_id;             -- 0629
  end if;                                                                                        -- 0629
  if v_post.post_id is not null then                                                             -- 0629
    select v_listing.listing_id, p.owner_id, p.world_slug, w.label_he, w.label_en,               -- 0629
           lk.kind_id, lk.slug, lk.label_he, lk.label_en, p.category_id,                         -- 0629
           case when p.direction = 'request' then 'request' else 'give' end, v_listing.status,   -- 0629
           p.visibility, public.visibility_to_anonymity_level(p.visibility), v_listing.title,    -- 0629
           v_listing.summary, p.geo, v_listing.city_id, p.time_window, p.expires_at, p.details, -- 0629
           v_listing.origin, p.post_id, null::uuid, p.urgency_level, p.availability_status,      -- 0629
           p.published_at, v_listing.created_at, v_listing.updated_at                            -- 0629
      into v_row                                                                                 -- 0629
      from public.posts p                                                                        -- 0629
      join public.worlds w on w.slug = p.world_slug                                              -- 0629
      join public.listing_kinds lk on lk.kind_id = coalesce(p.kind_id, v_listing.kind_id)        -- 0629
     where p.post_id = v_post.post_id;                                                           -- 0629
    -- 0629: the post's status in the listing's words; during a moderation hold the post's status
    -- 0629: is folded (0628) and the listing keeps its own.
    v_status := case when v_post.moderation_status <> 'published' then v_listing.status          -- 0629
                     else public.listing_status_for_post(v_post.status) end;                     -- 0629
    v_max_radius := v_post.max_radius_km_override;                                               -- 0629
  else                                                                                           -- 0629
    select * into v_row from public.marketplace_listing_card c where c.listing_id = v_listing_id;
  end if;                                                                                        -- 0629
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
    'availability_status', v_row.availability_status, 'status', v_status, -- 0629
    'published_at', v_row.published_at,
    'geo', case when v_row.geo is null then null else extensions.st_asgeojson(v_row.geo)::jsonb end,
    'max_radius_km', v_max_radius, -- 0629
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

-- ── 2. The owner's list (0413) ──────────────────────────────────────────────────────────────────
create or replace function public.list_my_listings(
  p_limit int default 50,
  p_offset int default 0,
  p_cursor_updated_at timestamptz default null,
  p_cursor_id uuid default null
)
returns table (
  listing_id uuid,
  world_slug text,
  kind_slug text,
  direction text,
  status text,
  title text,
  summary text,
  urgency_level smallint,
  availability_status text,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    l.listing_id,
    case when p.post_id is null then l.world_slug else p.world_slug end,                -- 0629
    lk.slug,
    case when p.post_id is null then l.direction                                        -- 0629
         when p.direction = 'request' then 'request' else 'give' end,                    -- 0629
    s.status,                                                                            -- 0629
    l.title,
    l.summary,
    case when p.post_id is null then l.urgency_level else p.urgency_level end,          -- 0629
    case when p.post_id is null then l.availability_status else p.availability_status end, -- 0629
    l.updated_at
  from public.listings l
  -- 0629: the post of a post-owned listing (the record); every other listing reads itself.
  left join public.posts p on p.post_id = l.legacy_post_id and l.origin = 'native'        -- 0629
  cross join lateral (select case when p.post_id is null or p.moderation_status <> 'published' -- 0629
                                  then l.status                                         -- 0629
                                  else public.listing_status_for_post(p.status) end as status) s -- 0629
  join public.listing_kinds lk on lk.kind_id = coalesce(p.kind_id, l.kind_id)            -- 0629
  where l.owner_id = auth.uid()
    and s.status <> 'removed_admin' -- 0629
    and (
      p_cursor_id is null
      or (l.updated_at, l.listing_id) < (p_cursor_updated_at, p_cursor_id)
    )
  order by l.updated_at desc, l.listing_id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset case when p_cursor_id is null then greatest(coalesce(p_offset, 0), 0) else 0 end;
$$;

revoke all on function public.list_my_listings(int, int, timestamptz, uuid) from public;
grant execute on function public.list_my_listings(int, int, timestamptz, uuid) to authenticated;

-- ── 3. A member's profile list (0338) ───────────────────────────────────────────────────────────
create or replace function public.list_profile_listings(
  p_owner_id uuid,
  p_limit int default 24
)
returns table (
  listing_id uuid,
  world_slug text,
  kind_slug text,
  direction text,
  status text,
  title text,
  summary text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    l.listing_id,
    case when p.post_id is null then l.world_slug else p.world_slug end,                -- 0629
    lk.slug,
    case when p.post_id is null then l.direction                                        -- 0629
         when p.direction = 'request' then 'request' else 'give' end,                    -- 0629
    s.status,                                                                            -- 0629
    l.title,
    l.summary
  from public.listings l
  -- 0629: the post of a post-owned listing (the record); every other listing reads itself.
  left join public.posts p on p.post_id = l.legacy_post_id and l.origin = 'native'        -- 0629
  cross join lateral (select case when p.post_id is null or p.moderation_status <> 'published' -- 0629
                                  then l.status                                         -- 0629
                                  else public.listing_status_for_post(p.status) end as status) s -- 0629
  join public.listing_kinds lk on lk.kind_id = coalesce(p.kind_id, l.kind_id)            -- 0629
  where l.owner_id = p_owner_id
    and (case when p.post_id is null then l.moderation_status else p.moderation_status end) = 'published' -- 0629
    and s.status in ('open', 'closed') -- 0629
    and (case when p.post_id is null then public.is_listing_visible_to(l, auth.uid())    -- 0629
              else public.post_listing_visible_to(p, auth.uid()) end)                    -- 0629
  order by (case when p.post_id is null then l.published_at else p.published_at end) desc nulls last, -- 0629
           l.created_at desc
  limit least(greatest(coalesce(p_limit, 24), 1), 50);
$$;

revoke all on function public.list_profile_listings(uuid, int) from public;
grant execute on function public.list_profile_listings(uuid, int) to anon, authenticated;

commit;
