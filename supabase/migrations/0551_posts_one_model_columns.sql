-- 0551_posts_one_model_columns | G1 step 1 (ADR-006, D2 / D19 / D104, BACKLOG G1-S1)
--
-- `posts` becomes able to describe every post type the listing side describes today, so the
-- later steps can move each flow without a schema change of their own:
--   world_slug          primary giving world (every post has one; items for the post engine)
--   direction           'offer' | 'request' — the product term; derived from the legacy `type`
--                       on write and kept in sync both ways by `posts_one_model_derive`
--   post_type           extension discriminator: 'standard' | 'ride' | 'event' | 'housing_stay' | 'job'
--   expires_at          per-type expiry (D21); null = never
--   source              'native' | 'imported' (WhatsApp import, S21)
--   details             type fields the create form stores (the listing `details` JSON today)
--   category_id         world sub-category (`public.categories`); items posts map their legacy
--                       `category` text to the items sub-category tree
--   geo, time_window, urgency_level, external_body_id, beneficiary_org_id — as on `listings`
--   status 'paused'     D104: hidden from everyone but the owner (a listing's 'cancelled')
-- Mirror posts (`posts.listing_id`, 0466 / 0522) are backfilled from their listing and kept
-- current by `listing_feed_mirror_upsert`. Native posts derive their values from the legacy
-- columns. Additive and idempotent: no column is dropped or renamed, no NOT NULL is set on an
-- existing column, every new NOT NULL column has a default.

begin;

-- ── 1. Columns ───────────────────────────────────────────────────────────────────────
alter table public.posts
  add column if not exists world_slug text not null default 'items' references public.worlds(slug),
  add column if not exists direction text not null default 'offer'
    check (direction in ('offer', 'request')),
  add column if not exists post_type text not null default 'standard'
    check (post_type in ('standard', 'ride', 'event', 'housing_stay', 'job')),
  add column if not exists expires_at timestamptz,
  add column if not exists source text not null default 'native'
    check (source in ('native', 'imported')),
  add column if not exists details jsonb not null default '{}'::jsonb,
  add column if not exists category_id uuid references public.categories(category_id) on delete set null,
  add column if not exists geo extensions.geography(point, 4326),
  add column if not exists time_window tstzrange,
  add column if not exists urgency_level smallint
    check (urgency_level is null or urgency_level between 1 and 3),
  add column if not exists external_body_id uuid references public.external_bodies(body_id) on delete set null,
  add column if not exists beneficiary_org_id uuid references public.organizations(org_id) on delete set null;

comment on column public.posts.world_slug is
  'Primary giving world of the post (D100). items for the post engine; a mirror follows its listing (G1 step 1, 0551).';
comment on column public.posts.direction is
  'offer | request (D19). Derived from the legacy `type` on insert; a later change of either keeps the other in step (0551).';
comment on column public.posts.post_type is
  'Extension discriminator: standard | ride (ride_post_details) | event | housing_stay | job (ADR-006).';
comment on column public.posts.expires_at is
  'When the post closes by itself (D21); null = never. Mirrors follow listings.expires_at.';
comment on column public.posts.source is
  'native (written in KC) | imported (WhatsApp import awaiting claim, S21).';
comment on column public.posts.details is
  'Type-specific fields of the post as the create form stores them (the listing detail JSON); {} on items posts.';
comment on column public.posts.category_id is
  'World sub-category (public.categories). Items posts map their legacy `category` text to the items tree.';

-- ── 2. The owner may pause a post (D104) ─────────────────────────────────────────────
alter table public.posts drop constraint if exists posts_status_check;
alter table public.posts add constraint posts_status_check check (status = any (array[
  'open', 'closed_delivered', 'deleted_no_recipient', 'expired', 'removed_admin',
  'hidden_pending_review', 'paused'
]));

-- ── 3. Backfill ─────────────────────────────────────────────────────────────────────
-- Mirror posts copy their listing. `give` is the listing word for `offer`.
update public.posts p
   set world_slug         = l.world_slug,
       direction          = case l.direction when 'request' then 'request' else 'offer' end,
       post_type          = case when l.world_slug = 'rides' then 'ride' else 'standard' end,
       expires_at         = l.expires_at,
       details            = coalesce(l.details, '{}'::jsonb),
       category_id        = l.category_id,
       geo                = l.geo,
       time_window        = l.time_window,
       urgency_level      = l.urgency_level,
       external_body_id   = l.external_body_id,
       beneficiary_org_id = l.beneficiary_org_id
  from public.listings l
 where l.listing_id = p.listing_id;

-- A paused listing's mirror was hidden as deleted_no_recipient; it is now paused.
update public.posts p
   set status = 'paused'
  from public.listings l
 where l.listing_id = p.listing_id
   and l.moderation_status = 'published'
   and l.status = 'cancelled'
   and p.status = 'deleted_no_recipient';

-- Native (items) posts derive from the legacy columns.
update public.posts p
   set world_slug  = 'items',
       direction   = case p.type when 'Request' then 'request' else 'offer' end,
       category_id = (select c.category_id from public.categories c
                       where c.world_slug = 'items' and c.legacy_post_category = p.category
                       order by c.sort_order limit 1),
       geo         = coalesce(p.geo, public.listing_geo_from_city(p.city))
 where p.listing_id is null;

-- ── 4. Invariants that hold from now on ─────────────────────────────────────────────
alter table public.posts drop constraint if exists posts_direction_type_chk;
alter table public.posts add constraint posts_direction_type_chk
  check ((type = 'Request') = (direction = 'request'));

alter table public.posts drop constraint if exists posts_ride_type_chk;
alter table public.posts add constraint posts_ride_type_chk
  check ((post_type = 'ride') = (world_slug = 'rides'));

create index if not exists posts_world_status_idx on public.posts (world_slug, status);
create index if not exists posts_expires_open_idx on public.posts (expires_at)
  where status = 'open' and expires_at is not null;

-- ── 5. Derive the new columns from the legacy ones on every write ───────────────────
-- Writers that still send only `type` / `category` get direction, world, sub-category and
-- geo for free; writers that send `direction` (later steps) get `type` for free.
create or replace function public.posts_one_model_derive()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_type_changed boolean := tg_op = 'UPDATE' and new.type is distinct from old.type;
  v_dir_changed  boolean := tg_op = 'UPDATE' and new.direction is distinct from old.direction;
begin
  -- direction ↔ type: on insert the legacy `type` wins (it is NOT NULL, every writer sends it);
  -- on update whichever side changed drives the other.
  if tg_op = 'INSERT' or v_type_changed or not v_dir_changed then
    new.direction := case new.type when 'Request' then 'request' else 'offer' end;
  else
    new.type := case new.direction when 'request' then 'Request' else 'Give' end;
  end if;

  -- A mirror belongs to its listing's world; a native post to the items world unless told otherwise.
  if new.listing_id is not null and new.listing_world_slug is not null then
    new.world_slug := new.listing_world_slug;
  end if;
  new.post_type := case when new.world_slug = 'rides' then 'ride'
                        when new.post_type = 'ride' then 'standard'
                        else new.post_type end;

  -- Native items posts: legacy category text → items sub-category; city → geo.
  if new.listing_id is null then
    if new.world_slug = 'items'
       and (tg_op = 'INSERT' or new.category is distinct from old.category or new.category_id is null) then
      select c.category_id into new.category_id
        from public.categories c
       where c.world_slug = 'items' and c.legacy_post_category = new.category
       order by c.sort_order limit 1;
    end if;
    if new.geo is null or (tg_op = 'UPDATE' and new.city is distinct from old.city) then
      new.geo := public.listing_geo_from_city(new.city);
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.posts_one_model_derive() from public, anon, authenticated;

drop trigger if exists posts_one_model_derive on public.posts;
create trigger posts_one_model_derive
  before insert or update on public.posts
  for each row execute function public.posts_one_model_derive();

-- ── 6. Mirror status: a paused listing is a paused post ─────────────────────────────
create or replace function public.listing_feed_mirror_status(p_listing public.listings)
returns text
language plpgsql
immutable
as $$
begin
  -- Not published (draft, pending review, rejected): out of the feed without a removal notice.
  if p_listing.moderation_status <> 'published' then
    return 'deleted_no_recipient';
  end if;
  return case p_listing.status
    when 'open' then 'open'
    when 'closed' then 'closed_delivered'
    when 'cancelled' then 'paused'
    when 'expired' then 'expired'
    when 'removed_admin' then 'removed_admin'
    when 'hidden_pending_review' then 'hidden_pending_review'
    else 'deleted_no_recipient'
  end;
end;
$$;

-- ── 7. The mirror upsert carries every one-model column ─────────────────────────────
-- Same body as 0522 §3 plus the new columns in the insert, the update and the no-op
-- comparison; after the row is current it fills the ride extension and the post handoffs
-- (0552 / 0553 define those two functions; the calls are guarded until then).
create or replace function public.listing_feed_mirror_upsert(p_listing public.listings)
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
      category, city, street, street_number, location_display_level, item_condition, created_at,
      world_slug, direction, post_type, expires_at, details, category_id, geo, time_window,
      urgency_level, external_body_id, beneficiary_org_id
    ) values (
      p_listing.owner_id, p_listing.listing_id, v_world, v_type, v_status, v_visibility, v_title,
      v_description, v_category, v_city, 'Marketplace', '1', 'CityOnly', v_condition,
      coalesce(p_listing.published_at, p_listing.created_at),
      v_world, v_direction, v_post_type, p_listing.expires_at, v_details, p_listing.category_id,
      p_listing.geo, p_listing.time_window, p_listing.urgency_level, p_listing.external_body_id,
      p_listing.beneficiary_org_id
    )
    returning post_id into v_post_id;
    v_inserted := true;

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
           beneficiary_org_id = p_listing.beneficiary_org_id
     where p.post_id = v_post_id
       and (p.type, p.status, p.visibility, p.title, p.description, p.category, p.city,
            p.item_condition, p.listing_world_slug, p.world_slug, p.direction, p.post_type,
            p.expires_at, p.details, p.category_id, p.geo::text, p.time_window, p.urgency_level,
            p.external_body_id, p.beneficiary_org_id)
           is distinct from
           (v_type, v_status, v_visibility, v_title, v_description, v_category, v_city,
            v_condition, v_world, v_world, v_direction, v_post_type,
            p_listing.expires_at, v_details, p_listing.category_id, p_listing.geo::text,
            p_listing.time_window, p_listing.urgency_level,
            p_listing.external_body_id, p_listing.beneficiary_org_id);
  end if;

  perform public.listing_feed_mirror_sync_media(p_listing.listing_id, v_post_id);

  -- Extensions (0552) and the closing stage (0553) follow the post; absent until those run.
  if v_post_type = 'ride' and to_regproc('public.ride_post_details_upsert') is not null then
    perform public.ride_post_details_upsert(v_post_id, v_details);
  end if;
  if v_inserted and to_regproc('public.post_handoffs_sync_listing') is not null then
    perform public.post_handoffs_sync_listing(p_listing.listing_id);
  end if;
  return v_post_id;
end;
$$;

revoke all on function public.listing_feed_mirror_upsert(public.listings) from public, anon, authenticated;
grant execute on function public.listing_feed_mirror_upsert(public.listings) to service_role;
revoke all on function public.listing_feed_mirror_status(public.listings) from public, anon, authenticated;
grant execute on function public.listing_feed_mirror_status(public.listings) to service_role;

-- The sync also fires for the listing columns the mirror now carries.
drop trigger if exists listings_feed_mirror_sync on public.listings;
create trigger listings_feed_mirror_sync
  after insert or update of title, summary, details, status, moderation_status,
    anonymity_level, city_id, category_id, direction, expires_at, time_window, urgency_level,
    geo, external_body_id, beneficiary_org_id on public.listings
  for each row execute function public.listings_feed_mirror_sync();

-- ── 8. The signed-in feed view exposes every posts column ───────────────────────────
-- `p.*` is expanded when the view is created (0417, 0522), so the view is re-created
-- whenever posts gains a column; the new columns land at the end, which
-- `create or replace view` allows. Same filter as 0522.
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

commit;
