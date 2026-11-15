-- Posts · posts (the one content table of every giving world)
--
-- Everything published in the product is one post (D2, D19): a primary giving world, a kind, a
-- direction, a lifecycle status and an audience. Fields that only some worlds have live in
-- `details` (validated against post_kinds.detail_schema) or in a 1:1 detail table added by
-- that world's module. The exact address is never stored here (post_private_locations).

create table public.posts (
  id                     uuid primary key default gen_random_uuid(),
  owner_id               uuid not null references public.users (id) on delete cascade,
  -- Organization the post is published for. The foreign key is added by the organizations
  -- module, which creates the referenced table.
  beneficiary_org_id     uuid,
  world_slug             text not null references public.worlds (slug) on update cascade,
  kind_id                uuid not null,
  -- Which 1:1 detail table, if any, extends the post.
  post_type              text not null default 'standard'
                           check (post_type in ('standard', 'ride', 'event', 'housing_stay', 'job', 'challenge')),
  direction              text not null check (direction in ('offer', 'request')),
  -- Lifecycle, machine `post` (030_post_status_machine.sql). Never written by a device.
  status                 text not null default 'open',
  -- Status held when an admin removed the post; a restore returns to it (D129).
  status_before_removal  text check (status_before_removal in
                           ('open', 'paused', 'closed_delivered', 'deleted_no_recipient', 'expired')),
  -- Audience chosen by the owner; may change freely after publishing (FR-POST-009).
  visibility             text not null default 'Public'
                           check (visibility in ('Public', 'FollowersOnly', 'OnlyMe')),
  title                  text not null check (char_length(title) between 1 and 80),
  description            text check (char_length(description) <= 500),
  item_subcategory_id    uuid,
  -- Type-specific fields. Only the shape is checked here; validation against the kind's
  -- JSON Schema is added with the module that enables the schema validator.
  details                jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  city_id                text not null references public.cities (city_id),
  -- How precisely the location is shown to others (FR-POST-003 AC3).
  location_display_level text not null default 'CityAndStreet'
                           check (location_display_level in ('CityOnly', 'CityAndStreet', 'FullAddress')),
  -- The only location other members, the map and matching ever read. Derived by trigger
  -- (050_post_private_locations.sql); never the exact address.
  geo_approx             extensions.geography(Point, 4326),
  -- When the offer or need applies (event time, availability window).
  time_window            tstzrange check (not isempty(time_window)),
  -- 1 low · 2 medium · 3 high.
  urgency_level          smallint check (urgency_level between 1 and 3),
  -- When the post closes by itself; null = never (D21). Set by server code per post kind.
  expires_at             timestamptz,
  -- 'imported' marks a post brought in from an external channel until it is claimed.
  source                 text not null default 'native' check (source in ('native', 'imported')),
  -- Detected BCP 47 language of title and description; written by the translation pipeline.
  source_language        text check (char_length(source_language) between 2 and 35),
  -- Search document; `simple` keeps Hebrew tokens unstemmed.
  search_vector          tsvector generated always as (
                           to_tsvector('simple', title || ' ' || coalesce(description, ''))) stored,
  -- First time the post became open; the feed sorts on it. Null while a draft.
  published_at           timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  -- The kind and the subcategory must belong to the post's own world.
  constraint posts_kind_fk foreign key (kind_id, world_slug)
    references public.post_kinds (id, world_slug) on update cascade,
  constraint posts_item_subcategory_fk foreign key (item_subcategory_id, world_slug)
    references public.item_subcategories (id, world_slug) on update cascade,
  -- The saved status exists exactly while the post is removed.
  constraint posts_removal_memory_chk
    check ((status = 'removed_admin') = (status_before_removal is not null)),
  -- A draft has never been published; every other status has.
  constraint posts_published_chk check ((status = 'draft') = (published_at is null))
);
comment on table public.posts is 'Every post of every giving world. Status moves only through server code.';

-- Main feed: open public posts, newest first (keyset on published_at, id).
create index posts_feed_recent_idx on public.posts (published_at desc, id desc)
  where status = 'open' and visibility = 'Public';
-- A profile's posts and "my posts" in any status, newest first; covers the owner foreign key.
create index posts_owner_recent_idx on public.posts (owner_id, created_at desc, id desc);
-- Browse a world by status, newest first; covers the world foreign key.
create index posts_world_status_recent_idx on public.posts (world_slug, status, published_at desc, id desc);
-- Feed and browse filtered by city; covers the city foreign key.
create index posts_city_recent_idx on public.posts (city_id, published_at desc, id desc) where status = 'open';
-- Expiry sweep: live posts whose time has come.
create index posts_expiry_due_idx on public.posts (expires_at)
  where expires_at is not null and status in ('open', 'paused');
-- Whole-word search over open posts.
create index posts_search_gin_idx on public.posts using gin (search_vector) where status = 'open';
-- Substring search over open posts (Hebrew has no useful stemming). A query must use the
-- same expression: (title || ' ' || coalesce(description, '')) ilike '%…%'.
create index posts_text_trgm_idx on public.posts
  using gin ((title || ' ' || coalesce(description, '')) extensions.gin_trgm_ops) where status = 'open';
-- Radius search, map pins and matching over open posts.
create index posts_geo_approx_gist_idx on public.posts using gist (geo_approx) where status = 'open';
-- Foreign keys to the catalog (a kind or subcategory being retired or renamed).
create index posts_kind_idx on public.posts (kind_id);
create index posts_item_subcategory_idx on public.posts (item_subcategory_id)
  where item_subcategory_id is not null;

create trigger posts_set_updated_at
  before update on public.posts
  for each row execute function kc_private.set_updated_at();
