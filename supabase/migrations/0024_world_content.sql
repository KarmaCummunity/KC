-- Worlds · links and knowledge of a giving world (FR-FEED-020 AC2, FR-DONATE-011, FR-KNOW-001)
--
-- The content a giving world shows next to its posts. Today it is mostly lists of links;
-- it grows into knowledge about the world. Four curated tables, loaded by
-- supabase/seed/content and edited by platform admins only:
--
--   world_links              a path from one world to a related one ("pet food" in the
--                            animals world opens the food world)
--   external_bodies          the organizations a world works through (blood services,
--                            shelters, registries), with their own site
--   knowledge_topics         the subject tree of a world's knowledge; every topic belongs to
--                            one world, so each world can hold its own subjects
--   knowledge_topic_aliases  other spellings of a topic (Hebrew, English, transliteration),
--                            unique once normalized, so search finds a topic by any of them
--
-- Growth path: knowledge items (articles, courses, documents) attach to a topic through its
-- id; the topic already carries the world, the tree position and a stable slug, so adding
-- them needs no change here. Community links of a world stay in public.donation_links.
--
-- Everyone may read the active rows, signed in or not: the content is public and holds no
-- personal data. Only platform admins write.

-- Text as search compares it: lower case, niqqud removed, Hebrew final letters folded to
-- their base form, everything that is not a letter or a digit turned into one space.
-- Immutable, so a generated column can use it.
create function kc_private.knowledge_normalize_text(p_text text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select btrim(regexp_replace(
    regexp_replace(
      translate(
        regexp_replace(lower(coalesce(p_text, '')), '[' || U&'\0591' || '-' || U&'\05C7' || ']', '', 'g'),
        U&'\05DA\05DD\05DF\05E3\05E5', U&'\05DB\05DE\05E0\05E4\05E6'),
      '[^a-z0-9' || U&'\05D0' || '-' || U&'\05EA' || ']+', ' ', 'g'),
    '\s+', ' ', 'g'));
$$;
comment on function kc_private.knowledge_normalize_text(text) is
  'Normal form of a topic alias or a search term: case, niqqud, final letters and punctuation removed.';

-- ── Links between worlds ────────────────────────────────────────────────────────────────
create table public.world_links (
  id              uuid primary key default gen_random_uuid(),
  -- The world that shows the link, and the world it opens.
  from_world_slug text not null references public.worlds (slug) on update cascade on delete cascade,
  to_world_slug   text not null references public.worlds (slug) on update cascade on delete cascade,
  -- Stable key of the link inside its world; the seed matches rows by it.
  link_slug       text not null check (link_slug ~ '^[a-z][a-z0-9_]{1,60}$'),
  label_he        text not null check (char_length(label_he) between 1 and 80),
  label_en        text not null check (char_length(label_en) between 1 and 80),
  description     text check (char_length(description) <= 280),
  is_active       boolean not null default true,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint world_links_world_slug_key unique (from_world_slug, link_slug),
  constraint world_links_not_self check (from_world_slug <> to_world_slug)
);
comment on table public.world_links is 'Curated paths from one giving world to a related one.';

-- The list of a world is served by the unique key; this covers the other foreign key.
create index world_links_to_world_idx on public.world_links (to_world_slug);

create trigger world_links_set_updated_at
  before update on public.world_links
  for each row execute function kc_private.set_updated_at();

-- ── External bodies ─────────────────────────────────────────────────────────────────────
create table public.external_bodies (
  id               uuid primary key default gen_random_uuid(),
  -- Stable key; the seed matches rows by it.
  slug             text not null unique check (slug ~ '^[a-z][a-z0-9_]{1,60}$'),
  world_slug       text not null references public.worlds (slug) on update cascade on delete cascade,
  label_he         text not null check (char_length(label_he) between 1 and 120),
  label_en         text not null check (char_length(label_en) between 1 and 120),
  body_type        text not null check (body_type in (
                     'blood_services', 'organ_registry', 'hospital', 'ngo', 'government', 'recycling', 'other')),
  -- Giving of this kind goes through the body and never directly between two members.
  requires_routing boolean not null default true,
  -- The body's own site; null until the team has confirmed the address.
  contact_url      text check (contact_url ~* '^https?://' and char_length(contact_url) <= 2000),
  -- The team confirmed that the body is what it says it is.
  is_verified      boolean not null default false,
  is_active        boolean not null default true,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
comment on table public.external_bodies is 'Organizations a giving world works through, with their own site.';

-- The bodies of one world, in display order (also covers the world foreign key).
create index external_bodies_world_idx on public.external_bodies (world_slug, sort_order, slug);

create trigger external_bodies_set_updated_at
  before update on public.external_bodies
  for each row execute function kc_private.set_updated_at();

-- ── Knowledge topics ────────────────────────────────────────────────────────────────────
create table public.knowledge_topics (
  id             uuid primary key default gen_random_uuid(),
  -- Stable key, unique across worlds; the seed matches rows by it.
  slug           text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 64),
  -- The world whose knowledge this topic organizes.
  world_slug     text not null references public.worlds (slug) on update cascade on delete cascade,
  -- Null for a root topic. A topic with children cannot be deleted; hide it instead.
  parent_id      uuid references public.knowledge_topics (id) on delete restrict,
  label_he       text not null check (char_length(label_he) between 1 and 80),
  label_en       text not null check (char_length(label_en) between 1 and 80),
  description_he text check (char_length(description_he) <= 280),
  -- active: shown · proposed: suggested, waits for review · merged: replaced by another topic.
  status         text not null default 'active' check (status in ('active', 'proposed', 'merged')),
  -- The topic that replaced a merged one; its slug keeps resolving to the replacement.
  merged_into_id uuid references public.knowledge_topics (id) on delete restrict,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint knowledge_topics_not_own_parent check (parent_id <> id),
  constraint knowledge_topics_merged_target check ((status = 'merged') = (merged_into_id is not null)),
  constraint knowledge_topics_not_merged_into_self check (merged_into_id <> id)
);
comment on table public.knowledge_topics is 'Subject tree of the knowledge of a giving world.';

-- The topics of one world, in display order (also covers the world foreign key).
create index knowledge_topics_world_idx on public.knowledge_topics (world_slug, sort_order, slug);
-- Children of a topic (covers the parent foreign key).
create index knowledge_topics_parent_idx on public.knowledge_topics (parent_id, sort_order)
  where parent_id is not null;
create index knowledge_topics_merged_into_idx on public.knowledge_topics (merged_into_id)
  where merged_into_id is not null;

create trigger knowledge_topics_set_updated_at
  before update on public.knowledge_topics
  for each row execute function kc_private.set_updated_at();

create table public.knowledge_topic_aliases (
  id         uuid primary key default gen_random_uuid(),
  topic_id   uuid not null references public.knowledge_topics (id) on delete cascade,
  alias      text not null check (char_length(alias) between 1 and 80),
  -- What search compares; two aliases that normalize to the same text are one alias.
  alias_norm text generated always as (kc_private.knowledge_normalize_text(alias)) stored,
  lang       text not null default 'he' check (lang in ('he', 'en', 'other')),
  created_at timestamptz not null default now(),
  constraint knowledge_topic_aliases_norm_key unique (alias_norm),
  constraint knowledge_topic_aliases_norm_not_empty check (kc_private.knowledge_normalize_text(alias) <> '')
);
comment on table public.knowledge_topic_aliases is 'Other spellings of a knowledge topic; unique once normalized.';

-- The aliases of one topic (covers the topic foreign key).
create index knowledge_topic_aliases_topic_idx on public.knowledge_topic_aliases (topic_id);

-- ── Access ──────────────────────────────────────────────────────────────────────────────
alter table public.world_links enable row level security;
alter table public.world_links force row level security;
alter table public.external_bodies enable row level security;
alter table public.external_bodies force row level security;
alter table public.knowledge_topics enable row level security;
alter table public.knowledge_topics force row level security;
alter table public.knowledge_topic_aliases enable row level security;
alter table public.knowledge_topic_aliases force row level security;

-- Read: everyone sees what is live. A guest has no admin role, so the admin branch is
-- written only in the member policy (kc_access functions are not granted to anon).
create policy world_links_select_guest on public.world_links
  for select to anon
  using (is_active);
create policy world_links_select on public.world_links
  for select to authenticated
  using (is_active or (select kc_access.has_admin_role('admin')));

create policy external_bodies_select_guest on public.external_bodies
  for select to anon
  using (is_active);
create policy external_bodies_select on public.external_bodies
  for select to authenticated
  using (is_active or (select kc_access.has_admin_role('admin')));

create policy knowledge_topics_select_guest on public.knowledge_topics
  for select to anon
  using (status = 'active');
create policy knowledge_topics_select on public.knowledge_topics
  for select to authenticated
  using (status = 'active' or (select kc_access.has_admin_role('admin')));

-- An alias is as visible as its topic: the topic's own policy decides inside the subquery.
create policy knowledge_topic_aliases_select on public.knowledge_topic_aliases
  for select to anon, authenticated
  using (exists (select 1 from public.knowledge_topics t where t.id = topic_id));

-- Write: platform admins only (admin and super admin).
create policy world_links_admin_insert on public.world_links
  for insert to authenticated
  with check ((select kc_access.has_admin_role('admin')));
create policy world_links_admin_update on public.world_links
  for update to authenticated
  using ((select kc_access.has_admin_role('admin')))
  with check ((select kc_access.has_admin_role('admin')));
create policy world_links_admin_delete on public.world_links
  for delete to authenticated
  using ((select kc_access.has_admin_role('admin')));

create policy external_bodies_admin_insert on public.external_bodies
  for insert to authenticated
  with check ((select kc_access.has_admin_role('admin')));
create policy external_bodies_admin_update on public.external_bodies
  for update to authenticated
  using ((select kc_access.has_admin_role('admin')))
  with check ((select kc_access.has_admin_role('admin')));
create policy external_bodies_admin_delete on public.external_bodies
  for delete to authenticated
  using ((select kc_access.has_admin_role('admin')));

create policy knowledge_topics_admin_insert on public.knowledge_topics
  for insert to authenticated
  with check ((select kc_access.has_admin_role('admin')));
create policy knowledge_topics_admin_update on public.knowledge_topics
  for update to authenticated
  using ((select kc_access.has_admin_role('admin')))
  with check ((select kc_access.has_admin_role('admin')));
create policy knowledge_topics_admin_delete on public.knowledge_topics
  for delete to authenticated
  using ((select kc_access.has_admin_role('admin')));

create policy knowledge_topic_aliases_admin_insert on public.knowledge_topic_aliases
  for insert to authenticated
  with check ((select kc_access.has_admin_role('admin')));
create policy knowledge_topic_aliases_admin_update on public.knowledge_topic_aliases
  for update to authenticated
  using ((select kc_access.has_admin_role('admin')))
  with check ((select kc_access.has_admin_role('admin')));
create policy knowledge_topic_aliases_admin_delete on public.knowledge_topic_aliases
  for delete to authenticated
  using ((select kc_access.has_admin_role('admin')));

-- Explicit grants. Whole-table SELECT: no column is hidden, so a reader may name any of them.
grant select on public.world_links to anon, authenticated;
grant select on public.external_bodies to anon, authenticated;
grant select on public.knowledge_topics to anon, authenticated;
grant select on public.knowledge_topic_aliases to anon, authenticated;
-- The policies above narrow these to platform admins.
grant insert, update, delete on public.world_links to authenticated;
grant insert, update, delete on public.external_bodies to authenticated;
grant insert, update, delete on public.knowledge_topics to authenticated;
grant insert, update, delete on public.knowledge_topic_aliases to authenticated;
