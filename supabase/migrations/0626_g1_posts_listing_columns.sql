-- 0626_g1_posts_listing_columns | G1 step 6a-5b (ADR-006, D-214, issue #1671): `posts` carries the
-- listing columns its readers still take from `listings`.
--
-- The later 6a-5 PRs move the owner RPCs, visibility / detail, browse / map and search onto
-- `posts`. They need, on the post, what only the listing held until now:
--   moderation_status       draft | pending_review | published | rejected (as on listings)
--   availability_status     immediate | scheduled | ongoing (as on listings)
--   kind_id                 the listing kind (`listing_kinds`)
--   published_at            when moderation first published it
--   max_radius_km_override  the owner's match radius
--   legacy_listing_id       the listing derived from or mirrored by the post, for every shape,
--                           items included; no foreign key (6d drops `listings`). `posts.listing_id`
--                           keeps its meaning: items posts leave it null.
-- Both shapes of a listing stay in the data:
--   * post-owned (`listings.legacy_post_id` = the post): the post pushes availability and the radius
--     to its listing; kind, publication and moderation come back from the listing;
--   * listing-sourced (a native listing with a mirror post): every column comes from the listing.
-- Function bodies are the latest definitions copied verbatim; every changed line carries a
-- `-- 0626:` note. Names, arguments, return types and grants are unchanged. Which listings get a
-- post is unchanged too. Additive and idempotent: no column is dropped, every new NOT NULL column
-- has a default.

begin;

-- ── 1. Columns ─────────────────────────────────────────────────────────────────────────────────

alter table public.posts
  add column if not exists moderation_status text not null default 'published'
    check (moderation_status in ('draft', 'pending_review', 'published', 'rejected')),
  add column if not exists availability_status text not null default 'ongoing'
    check (availability_status in ('immediate', 'scheduled', 'ongoing')),
  add column if not exists kind_id uuid references public.listing_kinds(kind_id),
  add column if not exists published_at timestamptz,
  add column if not exists max_radius_km_override numeric(8, 2)
    check (max_radius_km_override is null or max_radius_km_override > 0),
  add column if not exists legacy_listing_id uuid;

comment on column public.posts.moderation_status is
  'G1 (0626): the moderation state of the post''s listing (draft | pending_review | published | rejected); kept in step by the sync triggers.';
comment on column public.posts.availability_status is
  'G1 (0626): immediate | scheduled | ongoing. A post-owned listing follows the post; a mirror follows its listing.';
comment on column public.posts.kind_id is
  'G1 (0626): the listing kind (listing_kinds) of the post''s listing.';
comment on column public.posts.published_at is
  'G1 (0626): when moderation first published the post''s listing.';
comment on column public.posts.max_radius_km_override is
  'G1 (0626): the owner''s match radius. A post-owned listing follows the post; a mirror follows its listing.';
comment on column public.posts.legacy_listing_id is
  'G1 (0626): the listing derived from or mirrored by this post, for every shape (items included, whose listing_id stays null). No foreign key: listings is dropped in 6d.';

-- ── 2. Backfill from the listing of each post ──────────────────────────────────────────────────
-- A pure copy: the listing side is not written. The posts → listings sync is off while it runs
-- (nothing on the post side changes that the listing does not already hold), and so is the
-- updated_at stamp, since filling derived columns is not an edit (owner lists order by it).
alter table public.posts disable trigger posts_set_updated_at;
alter table public.posts disable trigger posts_sync_listing;

update public.posts p
   set moderation_status      = l.moderation_status,
       availability_status    = l.availability_status,
       kind_id                = l.kind_id,
       published_at           = l.published_at,
       max_radius_km_override = l.max_radius_km_override,
       legacy_listing_id      = l.listing_id
  from public.listings l
 where (l.legacy_post_id = p.post_id or (l.legacy_post_id is null and l.listing_id = p.listing_id))
   and (p.moderation_status, p.availability_status, p.kind_id, p.published_at,
        p.max_radius_km_override, p.legacy_listing_id)
       is distinct from
       (l.moderation_status, l.availability_status, l.kind_id, l.published_at,
        l.max_radius_km_override, l.listing_id);

alter table public.posts enable trigger posts_sync_listing;
alter table public.posts enable trigger posts_set_updated_at;

create unique index if not exists posts_legacy_listing_id_key
  on public.posts (legacy_listing_id) where legacy_listing_id is not null;

-- "My listings" on the post side (the later owner RPCs), as listings_owner_updated_keyset_idx (0413).
create index if not exists posts_owner_updated_keyset_idx
  on public.posts (owner_id, updated_at desc, post_id desc);

-- ── 3. posts → listings (0554): the post pushes availability and radius, takes the rest back ───
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

-- ── 4. listings → posts (0554): the new columns flow back to a post-owned listing's post ───────
create or replace function public.post_sync_from_listing(p_listing public.listings)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status     text := public.listing_feed_mirror_status(p_listing);
  v_visibility text := public.anonymity_level_to_visibility(p_listing.anonymity_level);
begin
  update public.posts p
     set status        = v_status,
         visibility    = v_visibility,
         expires_at    = p_listing.expires_at,
         details       = coalesce(p_listing.details, '{}'::jsonb),
         time_window   = p_listing.time_window,
         urgency_level = p_listing.urgency_level,
         geo           = p_listing.geo,
         category_id   = p_listing.category_id,
         listing_id    = p_listing.listing_id,
         listing_world_slug = p_listing.world_slug,
         moderation_status      = p_listing.moderation_status,      -- 0626
         availability_status    = p_listing.availability_status,    -- 0626
         kind_id                = p_listing.kind_id,                -- 0626
         published_at           = p_listing.published_at,           -- 0626
         max_radius_km_override = p_listing.max_radius_km_override, -- 0626
         legacy_listing_id      = p_listing.listing_id              -- 0626
   where p.post_id = p_listing.legacy_post_id
     and (p.status, p.visibility, p.expires_at, p.details, p.time_window, p.urgency_level,
          p.geo::text, p.category_id, p.listing_id, p.listing_world_slug,
          p.moderation_status, p.availability_status, p.kind_id, p.published_at,  -- 0626
          p.max_radius_km_override, p.legacy_listing_id)                          -- 0626
         is distinct from
         (v_status, v_visibility, p_listing.expires_at, coalesce(p_listing.details, '{}'::jsonb),
          p_listing.time_window, p_listing.urgency_level, p_listing.geo::text, p_listing.category_id,
          p_listing.listing_id, p_listing.world_slug,
          p_listing.moderation_status, p_listing.availability_status, p_listing.kind_id, -- 0626
          p_listing.published_at, p_listing.max_radius_km_override, p_listing.listing_id); -- 0626
  perform public.listing_feed_mirror_sync_media(p_listing.listing_id, p_listing.legacy_post_id);
  if p_listing.world_slug = 'rides' then
    perform public.ride_post_details_upsert(p_listing.legacy_post_id, coalesce(p_listing.details, '{}'::jsonb));
  end if;
end;
$$;

revoke all on function public.post_sync_from_listing(public.listings) from public, anon, authenticated;
grant execute on function public.post_sync_from_listing(public.listings) to service_role;

-- ── 5. The mirror of a listing-sourced listing carries the columns (0557) ──────────────────────
create or replace function public.listing_feed_mirror_upsert(p_listing public.listings, p_feed_hidden boolean default false)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post_id     uuid;
  v_inserted    boolean := false;
  v_type        text := case when p_listing.direction = 'request' then 'Request' else 'Give' end;
  v_direction   text := case when p_listing.direction = 'request' then 'request' else 'offer' end;
  v_status      text := public.listing_feed_mirror_status(p_listing);
  v_visibility  text := public.anonymity_level_to_visibility(p_listing.anonymity_level);
  v_title       text := left(p_listing.title, 80);
  v_description text := left(coalesce(nullif(trim(p_listing.summary), ''), p_listing.details ->> 'description'), 500);
  v_world       text := p_listing.world_slug;
  v_post_type   text := case when p_listing.world_slug = 'rides' then 'ride' else 'standard' end;
  v_details     jsonb := coalesce(p_listing.details, '{}'::jsonb);
  v_category    text;
  v_condition   text;
  v_city        text;
begin
  select c.legacy_post_category into v_category
    from public.categories c
   where c.category_id = p_listing.category_id;
  if v_category is null or v_category not in (
    'Furniture', 'Clothing', 'Books', 'Toys', 'BabyGear', 'Kitchen', 'Sports', 'Electronics', 'Tools', 'Other'
  ) then
    v_category := 'Other';
  end if;
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
      category, city, street, street_number, location_display_level, item_condition, created_at,
      world_slug, direction, post_type, expires_at, details, category_id, geo, time_window,
      urgency_level, external_body_id, beneficiary_org_id, feed_hidden,
      moderation_status, availability_status, kind_id, published_at,      -- 0626
      max_radius_km_override, legacy_listing_id                            -- 0626
    ) values (
      p_listing.owner_id, p_listing.listing_id, v_world, v_type, v_status, v_visibility, v_title,
      v_description, v_category, v_city, 'Marketplace', '1', 'CityOnly', v_condition,
      coalesce(p_listing.published_at, p_listing.created_at),
      v_world, v_direction, v_post_type, p_listing.expires_at, v_details, p_listing.category_id,
      p_listing.geo, p_listing.time_window, p_listing.urgency_level, p_listing.external_body_id,
      p_listing.beneficiary_org_id, p_feed_hidden,
      p_listing.moderation_status, p_listing.availability_status, p_listing.kind_id,  -- 0626
      p_listing.published_at, p_listing.max_radius_km_override, p_listing.listing_id  -- 0626
    )
    returning post_id into v_post_id;
    v_inserted := true;
    insert into public.listing_feed_posts (listing_id, post_id)
    values (p_listing.listing_id, v_post_id)
    on conflict (listing_id) do nothing;
  else
    -- An exposed post stays exposed: `p_feed_hidden = true` means "keep as it is", never "hide".
    update public.posts p
       set type               = v_type,
           status             = v_status,
           visibility         = v_visibility,
           title              = v_title,
           description        = v_description,
           category           = v_category,
           city               = v_city,
           item_condition     = v_condition,
           listing_world_slug = v_world,
           world_slug         = v_world,
           direction          = v_direction,
           post_type          = v_post_type,
           expires_at         = p_listing.expires_at,
           details            = v_details,
           category_id        = p_listing.category_id,
           geo                = p_listing.geo,
           time_window        = p_listing.time_window,
           urgency_level      = p_listing.urgency_level,
           external_body_id   = p_listing.external_body_id,
           beneficiary_org_id = p_listing.beneficiary_org_id,
           feed_hidden        = (p.feed_hidden and p_feed_hidden),
           moderation_status      = p_listing.moderation_status,      -- 0626
           availability_status    = p_listing.availability_status,    -- 0626
           kind_id                = p_listing.kind_id,                -- 0626
           published_at           = p_listing.published_at,           -- 0626
           max_radius_km_override = p_listing.max_radius_km_override, -- 0626
           legacy_listing_id      = p_listing.listing_id              -- 0626
     where p.post_id = v_post_id
       and (p.type, p.status, p.visibility, p.title, p.description, p.category, p.city,
            p.item_condition, p.listing_world_slug, p.world_slug, p.direction, p.post_type,
            p.expires_at, p.details, p.category_id, p.geo::text, p.time_window, p.urgency_level,
            p.external_body_id, p.beneficiary_org_id, p.feed_hidden,
            p.moderation_status, p.availability_status, p.kind_id, p.published_at,  -- 0626
            p.max_radius_km_override, p.legacy_listing_id)                          -- 0626
           is distinct from
           (v_type, v_status, v_visibility, v_title, v_description, v_category, v_city,
            v_condition, v_world, v_world, v_direction, v_post_type,
            p_listing.expires_at, v_details, p_listing.category_id, p_listing.geo::text,
            p_listing.time_window, p_listing.urgency_level,
            p_listing.external_body_id, p_listing.beneficiary_org_id, (p.feed_hidden and p_feed_hidden),
            p_listing.moderation_status, p_listing.availability_status, p_listing.kind_id, -- 0626
            p_listing.published_at, p_listing.max_radius_km_override, p_listing.listing_id); -- 0626
  end if;

  perform public.listing_feed_mirror_sync_media(p_listing.listing_id, v_post_id);
  if v_post_type = 'ride' and to_regproc('public.ride_post_details_upsert') is not null then
    perform public.ride_post_details_upsert(v_post_id, v_details);
  end if;
  if v_inserted and to_regproc('public.post_handoffs_sync_listing') is not null then
    perform public.post_handoffs_sync_listing(p_listing.listing_id);
  end if;
  return v_post_id;
end;
$$;

revoke all on function public.listing_feed_mirror_upsert(public.listings, boolean) from public, anon, authenticated;
grant execute on function public.listing_feed_mirror_upsert(public.listings, boolean) to service_role;

-- The sync also fires for the listing columns the post now carries (0551 list + 0626).
drop trigger if exists listings_feed_mirror_sync on public.listings;
create trigger listings_feed_mirror_sync
  after insert or update of title, summary, details, status, moderation_status,
    anonymity_level, city_id, category_id, direction, expires_at, time_window, urgency_level,
    geo, external_body_id, beneficiary_org_id,
    availability_status, kind_id, published_at, max_radius_km_override on public.listings -- 0626
  for each row execute function public.listings_feed_mirror_sync();

-- ── 6. The signed-in feed view exposes the new columns (0557 body) ─────────────────────────────
-- `p.*` is expanded when the view is created, so it is re-created whenever posts gains a column.
create or replace view public.feed_visible_posts
with (security_invoker = true) as
select p.*
  from public.posts p
 where not p.feed_hidden
   and not exists (
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

-- ── 7. The unification report counts listing-column mismatches (0553 body) ─────────────────────
-- `listing_column_mismatches`: posts whose new columns differ from their listing's, over both
-- shapes (post-owned through legacy_post_id, listing-sourced through listing_id).
create or replace function public.post_unification_report()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with mirrors as (
    select p.*, l.world_slug as l_world, l.direction as l_direction, l.expires_at as l_expires_at,
           l.details as l_details, l.category_id as l_category_id, l.geo as l_geo,
           l.time_window as l_time_window, l.urgency_level as l_urgency_level,
           public.listing_feed_mirror_status(l) as l_status
      from public.posts p
      join public.listings l on l.listing_id = p.listing_id
  ),
  without_post as (
    select l.world_slug, count(*) as n
      from public.listings l
     where public.post_id_of_listing(l.listing_id) is null
     group by l.world_slug
  ),
  ride_pairs as (
    select p.post_id as mirror_post_id, l.details as d, r.*
      from public.posts p
      join public.listings l on l.listing_id = p.listing_id and l.world_slug = 'rides'
      left join public.ride_post_details r on r.post_id = p.post_id
  ),
  handoff_pairs as (
    select g.*, t.handoff_id as t_id, t.post_id as t_post_id, t.status as t_status, t.seats as t_seats,
           t.recipient_id as t_recipient_id, t.confirmed_at as t_confirmed_at,
           t.handed_over_at as t_handed_over_at, t.cancelled_at as t_cancelled_at,
           public.post_id_of_listing(g.listing_id) as expected_post_id
      from public.giving_handoffs g
      left join public.post_handoffs t on t.handoff_id = g.handoff_id
  ),
  listing_pairs as ( -- 0626: every post and the listing derived from or mirrored by it
    select p.moderation_status, p.availability_status, p.kind_id, p.published_at,          -- 0626
           p.max_radius_km_override, p.legacy_listing_id, l.moderation_status as l_moderation_status, -- 0626
           l.availability_status as l_availability_status, l.kind_id as l_kind_id,          -- 0626
           l.published_at as l_published_at, l.max_radius_km_override as l_max_radius,      -- 0626
           l.listing_id as l_listing_id                                                     -- 0626
      from public.posts p                                                                   -- 0626
      join public.listings l on l.legacy_post_id = p.post_id                                -- 0626
    union all                                                                               -- 0626
    select p.moderation_status, p.availability_status, p.kind_id, p.published_at,          -- 0626
           p.max_radius_km_override, p.legacy_listing_id, l.moderation_status,              -- 0626
           l.availability_status, l.kind_id, l.published_at, l.max_radius_km_override,      -- 0626
           l.listing_id                                                                     -- 0626
      from public.posts p                                                                   -- 0626
      join public.listings l on l.listing_id = p.listing_id and l.legacy_post_id is null    -- 0626
  )
  select jsonb_build_object(
    'generated_at', now(),
    'listings_total', (select count(*) from public.listings),
    'listings_with_post', (select count(*) from public.listings l where public.post_id_of_listing(l.listing_id) is not null),
    'listings_without_post', coalesce((select jsonb_object_agg(world_slug, n) from without_post), '{}'::jsonb),
    'posts_total', (select count(*) from public.posts),
    'posts_mirrors', (select count(*) from mirrors),
    'mirror_field_mismatches', (
      select count(*) from mirrors m
       where (m.world_slug, m.direction, m.expires_at, m.details, m.category_id, m.time_window,
              m.urgency_level, m.status, m.geo::text)
             is distinct from
             (m.l_world, case m.l_direction when 'request' then 'request' else 'offer' end,
              m.l_expires_at, coalesce(m.l_details, '{}'::jsonb), m.l_category_id, m.l_time_window,
              m.l_urgency_level, m.l_status, m.l_geo::text)),
    'ride_posts_total', (select count(*) from ride_pairs),
    'ride_details_missing', (select count(*) from ride_pairs where post_id is null),
    'ride_field_mismatches', (
      select count(*) from ride_pairs rp
       where rp.departs_at is not null
         and (rp.departs_at, rp.seats_available, rp.origin_place_id, rp.dest_place_id, rp.arrives_at)
             is distinct from
             (nullif(rp.d ->> 'departs_at', '')::timestamptz, nullif(rp.d ->> 'seats_available', '')::integer,
              rp.d ->> 'origin_place_id', rp.d ->> 'dest_place_id', nullif(rp.d ->> 'arrives_at', '')::timestamptz)),
    'handoffs_total', (select count(*) from public.giving_handoffs),
    'post_handoffs_total', (select count(*) from public.post_handoffs),
    'handoffs_without_post', (select count(*) from handoff_pairs where expected_post_id is null),
    'handoff_rows_missing', (select count(*) from handoff_pairs where expected_post_id is not null and t_id is null),
    'handoff_field_mismatches', (
      select count(*) from handoff_pairs hp
       where hp.t_id is not null
         and (hp.t_post_id, hp.t_status, hp.t_seats, hp.t_recipient_id, hp.t_confirmed_at, hp.t_handed_over_at, hp.t_cancelled_at)
             is distinct from
             (hp.expected_post_id, hp.status, hp.seats, hp.recipient_id, hp.confirmed_at, hp.handed_over_at, hp.cancelled_at)),
    'listing_column_mismatches', (                                                          -- 0626
      select count(*) from listing_pairs lp                                                 -- 0626
       where (lp.moderation_status, lp.availability_status, lp.kind_id, lp.published_at,   -- 0626
              lp.max_radius_km_override, lp.legacy_listing_id)                              -- 0626
             is distinct from                                                               -- 0626
             (lp.l_moderation_status, lp.l_availability_status, lp.l_kind_id,               -- 0626
              lp.l_published_at, lp.l_max_radius, lp.l_listing_id))                         -- 0626
  );
$$;

comment on function public.post_unification_report() is
  'G1 verification: row counts of listings / posts / handoffs on both sides and the mismatches between them (ADR-006). service_role only.';

revoke all on function public.post_unification_report() from public, anon, authenticated;
grant execute on function public.post_unification_report() to service_role;

commit;
