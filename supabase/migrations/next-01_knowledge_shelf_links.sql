-- Knowledge · official body links per shelf (FR-KNOW-012 AC2, #2038)
--
-- KC-team content (S18): each knowledge shelf may list official bodies members should
-- contact for a binding answer (D40). Everyone reads the live rows; only platform
-- admins write. Seeded first for rights & legal aid (Kol Zchut).

create table public.knowledge_shelf_links (
  id          uuid primary key default gen_random_uuid(),
  -- D100 knowledge shelf slug (`item_subcategories.slug` under knowledge).
  shelf_slug  text not null check (shelf_slug in (
                'science_technology',
                'history_heritage',
                'culture_art',
                'spirituality_philosophy',
                'rights_legal_aid',
                'lessons_mentoring')),
  -- Stable key inside the shelf; the seed matches rows by it.
  link_slug   text not null check (link_slug ~ '^[a-z][a-z0-9_]{1,60}$'),
  label_he    text not null check (char_length(label_he) between 1 and 120),
  label_en    text not null check (char_length(label_en) between 1 and 120),
  url         text not null check (url ~* '^https?://' and char_length(url) <= 2000),
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint knowledge_shelf_links_shelf_slug_key unique (shelf_slug, link_slug)
);
comment on table public.knowledge_shelf_links is
  'Official body links shown on a knowledge shelf (FR-KNOW-012 AC2, D40).';

create index knowledge_shelf_links_shelf_idx
  on public.knowledge_shelf_links (shelf_slug, sort_order, link_slug);

create trigger knowledge_shelf_links_set_updated_at
  before update on public.knowledge_shelf_links
  for each row execute function kc_private.set_updated_at();

alter table public.knowledge_shelf_links enable row level security;
alter table public.knowledge_shelf_links force row level security;

create policy knowledge_shelf_links_select_guest on public.knowledge_shelf_links
  for select to anon
  using (is_active);
create policy knowledge_shelf_links_select on public.knowledge_shelf_links
  for select to authenticated
  using (is_active or (select kc_access.has_admin_role('admin')));

create policy knowledge_shelf_links_admin_insert on public.knowledge_shelf_links
  for insert to authenticated
  with check ((select kc_access.has_admin_role('admin')));
create policy knowledge_shelf_links_admin_update on public.knowledge_shelf_links
  for update to authenticated
  using ((select kc_access.has_admin_role('admin')))
  with check ((select kc_access.has_admin_role('admin')));
create policy knowledge_shelf_links_admin_delete on public.knowledge_shelf_links
  for delete to authenticated
  using ((select kc_access.has_admin_role('admin')));

grant select on public.knowledge_shelf_links to anon, authenticated;
grant insert, update, delete on public.knowledge_shelf_links to authenticated;

-- Rights & legal aid: Kol Zchut as the primary official body (18 §18.9, S18).
insert into public.knowledge_shelf_links
  (shelf_slug, link_slug, label_he, label_en, url, sort_order)
values
  ('rights_legal_aid', 'kol_zchut',
   'כל זכות', 'Kol Zchut',
   'https://www.kolzchut.org.il/', 10)
on conflict (shelf_slug, link_slug) do nothing;
