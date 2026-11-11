-- 0522_feed_mirror_every_world | FR-FEED-020 AC1 · backlog FEED-WORLDS · D-206
--
-- The main feed shows open listings of every create category (items, rides, food, housing,
-- time; product book docs/spec/07 §7.3 "main feed of all worlds"). 0466 mirrored only
-- items and food. This migration:
--
--   1. turns `worlds.feed_mirror` on for rides, housing and time;
--   2. adds `posts.listing_world_slug`: the giving world of a mirror's listing, so the feed
--      card can show the world (chip + icon) instead of the legacy post category, which is
--      "Other" for every world without the items subcategory tree;
--   3. re-creates `feed_visible_posts` (0417): its `p.*` was expanded before 0466, so the
--      signed-in feed never returned `posts.listing_id`, let alone the new column;
--   4. backfills the world on existing mirrors and mirrors every published open native
--      listing of the newly mirrored worlds.
--
-- Launch flags (`app_flags.world_*_enabled`, 0441) stay as they are: they decide whether a
-- world is active or a portal (D60), never whether its listings may reach the main feed.

begin;

-- ── 1. Every create category mirrors into the main feed ─────────────────────────────
update public.worlds
   set feed_mirror = true
 where slug in ('rides', 'housing', 'time');

-- ── 2. posts.listing_world_slug — the giving world a mirror post belongs to ──────────
alter table public.posts
  add column if not exists listing_world_slug text
    references public.worlds(slug);

comment on column public.posts.listing_world_slug is
  'Giving world of the listing a feed mirror reflects (D-206, FR-FEED-020); null on ordinary posts. Set and kept by listing_feed_mirror_upsert.';

-- ── 3. The mirror upsert also records the listing's world ────────────────────────────
-- Same body as 0466 §8 plus `listing_world_slug` in the insert, the update and the
-- no-op comparison, so an unchanged listing still writes nothing.
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
  v_world       text := p_listing.world_slug;
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
      owner_id, listing_id, listing_world_slug, type, status, visibility, title, description,
      category, city, street, street_number, location_display_level, item_condition, created_at
    ) values (
      p_listing.owner_id, p_listing.listing_id, v_world, v_type, v_status, v_visibility, v_title,
      v_description, v_category, v_city, 'Marketplace', '1', 'CityOnly', v_condition,
      coalesce(p_listing.published_at, p_listing.created_at)
    )
    returning post_id into v_post_id;

    insert into public.listing_feed_posts (listing_id, post_id)
    values (p_listing.listing_id, v_post_id)
    on conflict (listing_id) do nothing;
  else
    update public.posts p
       set type               = v_type,
           status             = v_status,
           visibility         = v_visibility,
           title              = v_title,
           description        = v_description,
           category           = v_category,
           city               = v_city,
           item_condition     = v_condition,
           listing_world_slug = v_world
     where p.post_id = v_post_id
       and (p.type, p.status, p.visibility, p.title, p.description, p.category, p.city,
            p.item_condition, p.listing_world_slug)
           is distinct from
           (v_type, v_status, v_visibility, v_title, v_description, v_category, v_city,
            v_condition, v_world);
  end if;

  perform public.listing_feed_mirror_sync_media(p_listing.listing_id, v_post_id);
  return v_post_id;
end;
$$;

-- `create or replace` keeps the 0520 grants; restated so this migration is self-contained.
revoke all on function public.listing_feed_mirror_upsert(public.listings) from public, anon, authenticated;
grant execute on function public.listing_feed_mirror_upsert(public.listings) to service_role;

-- ── 4. Existing mirrors learn their world; then the column is mandatory on mirrors ───
update public.posts p
   set listing_world_slug = l.world_slug
  from public.listings l
 where l.listing_id = p.listing_id
   and p.listing_world_slug is distinct from l.world_slug;

alter table public.posts
  add constraint posts_listing_world_slug_chk
    check ((listing_id is null) = (listing_world_slug is null));

-- ── 5. The signed-in feed source returns every posts column again ────────────────────
-- Same filter as 0417. `p.*` is expanded when the view is created, so it is re-created
-- whenever posts gains a column the feed reads; the new columns land at the end, which
-- `create or replace view` allows.
create or replace view public.feed_visible_posts
with (security_invoker = true) as
select p.*
  from public.posts p
 where not exists (
         select 1
           from public.feed_post_hides h
          where h.user_id = (select auth.uid())
            and h.post_id = p.post_id
       )
   and not exists (
         select 1
           from public.feed_mute_filters mf
          where mf.user_id = (select auth.uid())
            and (
              (mf.filter_kind = 'user' and mf.filter_value = p.owner_id::text)
              or (mf.filter_kind in ('category', 'world') and mf.filter_value = p.category)
              or (mf.filter_kind = 'keyword' and (
                p.title ilike '%' || public.escape_ilike(mf.filter_value) || '%' escape '\'
                or coalesce(p.description, '') ilike '%' || public.escape_ilike(mf.filter_value) || '%' escape '\'
              ))
            )
       );

revoke all on public.feed_visible_posts from public, anon;
grant select on public.feed_visible_posts to authenticated;

-- ── 6. Backfill: every published open native listing of the newly mirrored worlds ────
-- One failing listing is reported and skipped; it never blocks the others or the deploy.
do $$
declare
  r public.listings%rowtype;
begin
  for r in
    select l.*
      from public.listings l
     where l.world_slug in ('rides', 'housing', 'time')
       and l.origin = 'native'
       and l.status = 'open'
       and l.moderation_status = 'published'
       and not exists (select 1 from public.posts p where p.listing_id = l.listing_id)
     order by l.created_at
  loop
    begin
      perform public.listing_feed_mirror_upsert(r);
    exception when others then
      raise warning 'feed_mirror_every_world backfill: listing % skipped: %', r.listing_id, sqlerrm;
    end;
  end loop;
end $$;

commit;
