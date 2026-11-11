-- 0466_listing_feed_mirror | KC#1101 / KC#1109 AC "listing appears in feed" · D-206
--
-- Native items and food listings never reached the main feed: the feed reads `posts`
-- (`feed_ranked_ids` / `feed_open_posts_mv`) and a listing only got there when its owner
-- tapped "share to feed" (`share_listing_to_feed`, 0322), which made a one-off copy that
-- ignored later edits and closing. Worse, the copy fired `posts_sync_listing` (0243) and
-- created a second, `origin = 'post'` listing in the marketplace.
--
-- This migration keeps one mirror post per native listing of a feed-mirrored world
-- (`worlds.feed_mirror`, on for items and food), created on publish and kept in sync on
-- every relevant listing write, media change and status change. The link is the new
-- `posts.listing_id` column (the mirror disappears with its listing through the FK);
-- `listing_feed_posts` stays populated for existing readers. The mirror carries the
-- listing photos (`media_assets.bucket = 'listing-images'`), never counts toward the
-- 20 open-posts cap, and is skipped by the posts → listings sync, which closes the
-- duplicate-listing bug above. `share_listing_to_feed` now reuses the same upsert, so
-- the manual share is idempotent and self-updating for every world.

begin;

-- ── 1. Which worlds mirror their native listings into the feed ───────────────────────
alter table public.worlds
  add column if not exists feed_mirror boolean not null default false;

comment on column public.worlds.feed_mirror is
  'When true, every published open native listing of this world keeps a mirror row in public.posts so it shows in the main feed (D-206).';

update public.worlds set feed_mirror = true where slug in ('items', 'food');

-- ── 2. posts.listing_id — the canonical link from a mirror post to its listing ───────
alter table public.posts
  add column if not exists listing_id uuid
    references public.listings(listing_id) on delete cascade;

comment on column public.posts.listing_id is
  'Set on a feed mirror of a native listing (D-206). The listing is the source of truth: title, status, visibility and photos follow it; the detail screen opens the listing.';

create unique index if not exists posts_listing_id_key
  on public.posts (listing_id) where listing_id is not null;

-- Existing manual shares become proper mirrors.
update public.posts p
   set listing_id = f.listing_id
  from public.listing_feed_posts f
 where f.post_id = p.post_id
   and p.listing_id is null;

-- ── 3. media_assets.bucket — a mirror shows the listing's photos from their own bucket ─
alter table public.media_assets
  add column if not exists bucket text not null default 'post-images'
    check (bucket in ('post-images', 'listing-images'));

comment on column public.media_assets.bucket is
  'Storage bucket the path lives in. post-images for uploads; listing-images for the photos a feed mirror borrows from its listing (D-206).';

-- ── 4. Mirror posts never count toward the open-posts cap (FR-POST-011) ─────────────
create or replace function public.posts_enforce_active_cap()
returns trigger language plpgsql as $$
declare
  active_n int;
begin
  -- A feed mirror follows its listing; the listing worlds have their own limits.
  if new.listing_id is not null then
    return new;
  end if;
  -- Admin restore exemption: removed_admin → open is moderation, not creation.
  if tg_op = 'UPDATE' and old.status = 'removed_admin' and new.status = 'open' then
    return new;
  end if;
  if new.status = 'open' and (tg_op = 'INSERT' or old.status <> 'open') then
    select count(*) into active_n
    from public.posts
    where owner_id = new.owner_id and status = 'open' and listing_id is null;
    if active_n >= 20 then
      raise exception 'active_post_limit_exceeded'
        using errcode = 'check_violation', detail = 'limit=20';
    end if;
  end if;
  return new;
end;
$$;

-- ── 5. Karma, profile counters and closure chat messages stay with the listing ──────
-- The listing flow is authoritative for its economics (handoff karma, 0453) and its chat
-- messaging; a mirror only reflects the listing in the feed. Without these guards every
-- mirror would earn the +5 post_created award, count as a plain post in the profile
-- counters, and a closed listing would trip the closure-message trigger's strict
-- recipients lookup (0031), which no mirror satisfies.
drop trigger if exists karma_posts_after_insert on public.posts;
create trigger karma_posts_after_insert
  after insert on public.posts
  for each row when (new.listing_id is null)
  execute function public.karma_on_post_change();

drop trigger if exists karma_posts_after_status_update on public.posts;
create trigger karma_posts_after_status_update
  after update of status on public.posts
  for each row when (new.listing_id is null)
  execute function public.karma_on_post_change();

drop trigger if exists posts_after_update_emit_closure_messages on public.posts;
create trigger posts_after_update_emit_closure_messages
  after update of status on public.posts
  for each row when (new.listing_id is null)
  execute function public.posts_emit_closure_system_messages();

drop trigger if exists posts_after_insert_counters on public.posts;
create trigger posts_after_insert_counters
  after insert on public.posts
  for each row when (new.listing_id is null)
  execute function public.posts_after_change_counters();

drop trigger if exists posts_after_update_counters on public.posts;
create trigger posts_after_update_counters
  after update of status, visibility on public.posts
  for each row when (new.listing_id is null)
  execute function public.posts_after_change_counters();

drop trigger if exists posts_after_delete_counters on public.posts;
create trigger posts_after_delete_counters
  after delete on public.posts
  for each row when (old.listing_id is null)
  execute function public.posts_after_change_counters();

-- ── 6. The posts → listings sync skips mirrors (no second listing per listing) ───────
create or replace function public.trg_posts_sync_listing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.listing_id is null then
    perform public.listing_upsert_from_post(new);
  end if;
  return new;
end;
$$;

-- ── 7. Mirror photos: the listing's media, in listing order, at most five ────────────
-- Only objects that exist in storage are mirrored, with their real size and type, so the
-- media_assets checks stay truthful; a listing without uploaded photos mirrors none.
create or replace function public.listing_feed_mirror_sync_media(p_listing_id uuid, p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.media_assets
   where post_id = p_post_id
     and bucket = 'listing-images';

  insert into public.media_assets (post_id, ordinal, bucket, path, mime_type, size_bytes)
  select p_post_id,
         (row_number() over (order by m.sort_order, m.created_at)) - 1,
         'listing-images',
         m.storage_path,
         coalesce(o.metadata ->> 'mimetype', 'image/jpeg'),
         (o.metadata ->> 'size')::integer
    from public.listing_media m
    join storage.objects o
      on o.bucket_id = 'listing-images'
     and o.name = m.storage_path
   where m.listing_id = p_listing_id
     and coalesce((o.metadata ->> 'size')::integer, 0) between 1 and 8 * 1024 * 1024
     and coalesce(o.metadata ->> 'mimetype', 'image/jpeg') in ('image/jpeg', 'image/png', 'image/heic')
   order by m.sort_order, m.created_at
   limit 5;
end;
$$;

-- ── 8. One mirror per listing: create or bring it in line with the listing ───────────
create or replace function public.listing_feed_mirror_status(p_listing public.listings)
returns text
language plpgsql
immutable
as $$
begin
  -- A listing that is not published (draft, pending review, rejected) stays out of the
  -- feed the same way a paused one does: hidden, without any removal notice.
  if p_listing.moderation_status <> 'published' then
    return 'deleted_no_recipient';
  end if;
  return case p_listing.status
    when 'open' then 'open'
    when 'closed' then 'closed_delivered'
    when 'expired' then 'expired'
    when 'removed_admin' then 'removed_admin'
    when 'hidden_pending_review' then 'hidden_pending_review'
    else 'deleted_no_recipient'
  end;
end;
$$;

create or replace function public.listing_feed_mirror_upsert(p_listing public.listings)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post_id     uuid;
  v_type        text := case when p_listing.direction = 'request' then 'Request' else 'Give' end;
  v_status      text := public.listing_feed_mirror_status(p_listing);
  v_visibility  text := public.anonymity_level_to_visibility(p_listing.anonymity_level);
  v_title       text := left(p_listing.title, 80);
  v_description text := left(coalesce(nullif(trim(p_listing.summary), ''), p_listing.details ->> 'description'), 500);
  v_category    text;
  v_condition   text;
  v_city        text;
begin
  -- The items subcategory tree carries the legacy post category; everything else is Other.
  select c.legacy_post_category into v_category
    from public.categories c
   where c.category_id = p_listing.category_id;
  if v_category is null or v_category not in (
    'Furniture', 'Clothing', 'Books', 'Toys', 'BabyGear', 'Kitchen', 'Sports', 'Electronics', 'Tools', 'Other'
  ) then
    v_category := 'Other';
  end if;

  -- posts.item_condition exists for Give only (posts_type_fields_chk).
  if v_type = 'Give' then
    v_condition := case lower(p_listing.details ->> 'item_condition')
      when 'new' then 'New'
      when 'like_new' then 'LikeNew'
      when 'likenew' then 'LikeNew'
      when 'good' then 'Good'
      when 'fair' then 'Fair'
      else null
    end;
  end if;

  -- posts.city is mandatory: the listing's city, else the owner's, else the platform default.
  v_city := coalesce(
    p_listing.city_id,
    (select u.city from public.users u where u.user_id = p_listing.owner_id),
    'tel-aviv'
  );

  select p.post_id into v_post_id
    from public.posts p
   where p.listing_id = p_listing.listing_id;

  if v_post_id is null then
    insert into public.posts (
      owner_id, listing_id, type, status, visibility, title, description, category,
      city, street, street_number, location_display_level, item_condition, created_at
    ) values (
      p_listing.owner_id, p_listing.listing_id, v_type, v_status, v_visibility, v_title,
      v_description, v_category, v_city, 'Marketplace', '1', 'CityOnly', v_condition,
      coalesce(p_listing.published_at, p_listing.created_at)
    )
    returning post_id into v_post_id;

    insert into public.listing_feed_posts (listing_id, post_id)
    values (p_listing.listing_id, v_post_id)
    on conflict (listing_id) do nothing;
  else
    update public.posts p
       set type           = v_type,
           status         = v_status,
           visibility     = v_visibility,
           title          = v_title,
           description    = v_description,
           category       = v_category,
           city           = v_city,
           item_condition = v_condition
     where p.post_id = v_post_id
       and (p.type, p.status, p.visibility, p.title, p.description, p.category, p.city, p.item_condition)
           is distinct from
           (v_type, v_status, v_visibility, v_title, v_description, v_category, v_city, v_condition);
  end if;

  perform public.listing_feed_mirror_sync_media(p_listing.listing_id, v_post_id);
  return v_post_id;
end;
$$;

-- ── 9. Listing writes keep the mirror current; a listing write never fails for it ─────
create or replace function public.listings_feed_mirror_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mirrored boolean;
begin
  if new.origin <> 'native' then
    return new;
  end if;

  select exists (select 1 from public.posts p where p.listing_id = new.listing_id)
    into v_mirrored;

  -- Without a mirror yet, only a published open listing of a mirrored world gets one.
  if not v_mirrored then
    if new.moderation_status <> 'published' or new.status <> 'open' then
      return new;
    end if;
    if not exists (select 1 from public.worlds w where w.slug = new.world_slug and w.feed_mirror) then
      return new;
    end if;
  end if;

  begin
    perform public.listing_feed_mirror_upsert(new);
  exception when others then
    raise warning 'listing_feed_mirror: listing % not mirrored: % (%)', new.listing_id, sqlerrm, sqlstate;
  end;
  return new;
end;
$$;

drop trigger if exists listings_feed_mirror_sync on public.listings;
create trigger listings_feed_mirror_sync
  after insert or update of title, summary, details, status, moderation_status,
    anonymity_level, city_id, category_id, direction on public.listings
  for each row execute function public.listings_feed_mirror_sync();

-- Photos are attached after the listing row exists (attach_listing_media), so the media
-- table drives its own resync.
create or replace function public.listing_media_feed_mirror_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing_id uuid := case when tg_op = 'DELETE' then old.listing_id else new.listing_id end;
  v_post_id uuid;
begin
  select p.post_id into v_post_id from public.posts p where p.listing_id = v_listing_id;
  if v_post_id is not null then
    begin
      perform public.listing_feed_mirror_sync_media(v_listing_id, v_post_id);
    exception when others then
      raise warning 'listing_feed_mirror: media of listing % not mirrored: %', v_listing_id, sqlerrm;
    end;
  end if;
  return null;
end;
$$;

drop trigger if exists listing_media_feed_mirror_sync on public.listing_media;
create trigger listing_media_feed_mirror_sync
  after insert or update of storage_path, sort_order or delete on public.listing_media
  for each row execute function public.listing_media_feed_mirror_sync();

-- ── 10. Manual share = the same mirror, for every world ──────────────────────────────
create or replace function public.share_listing_to_feed(p_listing_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_listing public.listings;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;

  select * into v_listing from public.listings where listing_id = p_listing_id;
  if not found or v_listing.owner_id <> v_uid then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return public.listing_feed_mirror_upsert(v_listing);
end;
$$;

revoke all on function public.share_listing_to_feed(uuid) from public;
grant execute on function public.share_listing_to_feed(uuid) to authenticated;

revoke all on function public.listing_feed_mirror_upsert(public.listings) from public;
revoke all on function public.listing_feed_mirror_sync_media(uuid, uuid) from public;
revoke all on function public.listing_feed_mirror_status(public.listings) from public;
grant execute on function public.listing_feed_mirror_upsert(public.listings) to service_role;
grant execute on function public.listing_feed_mirror_sync_media(uuid, uuid) to service_role;
grant execute on function public.listing_feed_mirror_status(public.listings) to service_role;

-- ── 11. The listing detail says whether it already has a feed post ───────────────────
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
  if not found then
    return null;
  end if;

  if not public.is_listing_visible_to(v_listing, v_viewer) then
    return null;
  end if;

  select * into v_row
    from public.marketplace_listing_card c
   where c.listing_id = p_listing_id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'storage_path', m.storage_path,
      'sort_order', m.sort_order
    ) order by m.sort_order
  ), '[]'::jsonb)
    into v_media
    from public.listing_media m
   where m.listing_id = p_listing_id;

  select jsonb_build_object(
    'user_id', u.user_id,
    'display_name', u.display_name,
    'avatar_url', u.avatar_url,
    'share_handle', u.share_handle,
    'city_id', u.city
  )
    into v_owner
    from public.users u
   where u.user_id = v_row.owner_id;

  return jsonb_build_object(
    'listing_id', v_row.listing_id,
    'owner_id', v_row.owner_id,
    'world_slug', v_row.world_slug,
    'world_label_en', v_row.world_label_en,
    'world_label_he', v_row.world_label_he,
    'kind_slug', v_row.kind_slug,
    'kind_label_en', v_row.kind_label_en,
    'kind_label_he', v_row.kind_label_he,
    'direction', v_row.direction,
    'title', v_row.title,
    'summary', v_row.summary,
    'details', v_row.details,
    'city_id', v_row.city_id,
    'urgency_level', v_row.urgency_level,
    'availability_status', v_row.availability_status,
    'published_at', v_row.published_at,
    'geo', case when v_row.geo is null then null else extensions.st_asgeojson(v_row.geo)::jsonb end,
    'max_radius_km', (select l.max_radius_km_override from public.listings l where l.listing_id = p_listing_id),
    'media', v_media,
    'owner', v_owner,
    'feed_post_id', (select p.post_id from public.posts p where p.listing_id = p_listing_id)
  );
end;
$$;

revoke all on function public.get_marketplace_listing_detail(uuid) from public;
grant execute on function public.get_marketplace_listing_detail(uuid) to anon, authenticated;

-- ── 12. Backfill: every published open native listing of a mirrored world ────────────
do $$
declare
  r public.listings%rowtype;
begin
  for r in
    select l.*
      from public.listings l
      join public.worlds w on w.slug = l.world_slug and w.feed_mirror
     where l.origin = 'native'
       and l.status = 'open'
       and l.moderation_status = 'published'
       and not exists (select 1 from public.posts p where p.listing_id = l.listing_id)
     order by l.created_at
  loop
    begin
      perform public.listing_feed_mirror_upsert(r);
    exception when others then
      raise warning 'listing_feed_mirror backfill: listing % skipped: %', r.listing_id, sqlerrm;
    end;
  end loop;
end $$;

commit;
