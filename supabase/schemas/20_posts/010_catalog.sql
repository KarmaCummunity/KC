-- Posts · catalog (giving worlds, post kinds, item subcategories)
--
-- Configuration that decides what a post may be. Rows are loaded by the seed scripts and
-- changed only by migrations or server code: a device can read the catalog, never write it.
-- One list of giving worlds, with no second "domain" layer (D100).

-- A giving world (D100) and its per-world behaviour.
create table public.worlds (
  slug                    text primary key check (slug ~ '^[a-z][a-z0-9_]{1,30}$'),
  label_he                text not null,
  label_en                text not null,
  -- How careful the product is with this world's content (review, exposure).
  sensitivity             text not null default 'standard'
                            check (sensitivity in ('standard', 'elevated', 'restricted')),
  -- Publishing in this world requires a verified identity (for example housing, D30).
  requires_verification   boolean not null default false,
  -- Default audience of the poster's identity: 1 operators only · 2 followers · 3 everyone.
  default_anonymity_level smallint not null default 3 check (default_anonymity_level between 1 and 3),
  -- Default lifetime of a post; null = posts of this world do not expire (D21).
  default_ttl_hours       integer check (default_ttl_hours > 0),
  -- Whether distance matters: nearby, same region, or not at all (online).
  geo_mode                text not null default 'local' check (geo_mode in ('local', 'regional', 'remote')),
  default_radius_km       numeric(8, 2) not null default 25 check (default_radius_km > 0),
  -- Share of distance in ranking and matching for this world, 0 to 1.
  geo_weight              numeric(4, 3) not null default 1 check (geo_weight between 0 and 1),
  -- Posts of this world also appear in the main feed, not only on the world's own screen.
  shows_in_main_feed      boolean not null default false,
  -- An inactive world is kept for its existing posts but accepts no new ones.
  is_active               boolean not null default true,
  sort_order              integer not null default 0,
  created_at              timestamptz not null default now()
);
comment on table public.worlds is 'Giving worlds (D100) and their per-world configuration.';

-- What can be posted in a world: "ride offer", "lesson request", "item". Each kind owns the
-- JSON Schema of the type-specific fields stored in posts.details.
create table public.post_kinds (
  id                uuid primary key default gen_random_uuid(),
  world_slug        text not null references public.worlds (slug) on update cascade on delete cascade,
  slug              text not null check (slug ~ '^[a-z][a-z0-9_]{1,40}$'),
  label_he          text not null,
  label_en          text not null,
  -- Which side may use this kind; posts.direction must agree.
  direction         text not null check (direction in ('offer', 'request', 'either')),
  -- JSON Schema for posts.details of this kind.
  detail_schema     jsonb not null default '{"type":"object"}'::jsonb
                      check (jsonb_typeof(detail_schema) = 'object'),
  -- Overrides the world's default lifetime; null = follow the world.
  default_ttl_hours integer check (default_ttl_hours > 0),
  is_active         boolean not null default true,
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now(),
  constraint post_kinds_world_slug_key unique (world_slug, slug),
  -- Target of the composite foreign key that keeps a post's kind inside the post's world.
  constraint post_kinds_id_world_key unique (id, world_slug)
);
comment on table public.post_kinds is 'Kinds of post per giving world; detail_schema describes posts.details.';

-- Kind picker of a world's create form (also covers the world_slug foreign key).
create index post_kinds_world_order_idx on public.post_kinds (world_slug, sort_order);

-- Sub-categories of a giving world, as a tree (item subcategory, food type, knowledge shelf).
-- Replaces the fixed item list that used to be a check constraint on posts.
create table public.item_subcategories (
  id         uuid primary key default gen_random_uuid(),
  world_slug text not null references public.worlds (slug) on update cascade on delete cascade,
  parent_id  uuid,
  slug       text not null check (slug ~ '^[a-z][a-z0-9_]{1,40}$'),
  label_he   text not null,
  label_en   text not null,
  is_active  boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint item_subcategories_world_slug_key unique (world_slug, slug),
  constraint item_subcategories_id_world_key unique (id, world_slug),
  constraint item_subcategories_not_own_parent_chk check (parent_id <> id),
  -- A child always belongs to its parent's world.
  constraint item_subcategories_parent_fk foreign key (parent_id, world_slug)
    references public.item_subcategories (id, world_slug) on update cascade on delete cascade
);
comment on table public.item_subcategories is 'Per-world sub-category tree; a post points at one node of its own world.';

-- Children of a node in display order: the subcategory picker and browse filters.
create index item_subcategories_tree_idx on public.item_subcategories (world_slug, parent_id, sort_order);
-- Covers the parent foreign key (cascade on removing a node).
create index item_subcategories_parent_idx on public.item_subcategories (parent_id) where parent_id is not null;

alter table public.worlds enable row level security;
alter table public.worlds force row level security;
alter table public.post_kinds enable row level security;
alter table public.post_kinds force row level security;
alter table public.item_subcategories enable row level security;
alter table public.item_subcategories force row level security;

-- Read-only configuration for signed-in members. No insert, update or delete policy and no
-- write grant exist, so the catalog cannot be changed from a device.
create policy worlds_select_member on public.worlds
  for select to authenticated
  using (true);
create policy post_kinds_select_member on public.post_kinds
  for select to authenticated
  using (true);
create policy item_subcategories_select_member on public.item_subcategories
  for select to authenticated
  using (true);

grant select on public.worlds to authenticated;
grant select on public.post_kinds to authenticated;
grant select on public.item_subcategories to authenticated;
