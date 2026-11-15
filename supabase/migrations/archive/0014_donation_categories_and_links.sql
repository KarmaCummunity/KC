-- 0014_donation_categories_and_links | FR-DONATE-006..009
-- Community-curated NGO link lists per donation category.
-- Auto-publish; Edge Function (validate-donation-link) inserts after URL reachability check.
-- Direct INSERT from client roles is blocked.

-- ── 1. donation_categories (lookup) ──────────────────────────────────────────
create table if not exists public.donation_categories (
  slug        text primary key
    check (slug in ('time','money','food','housing','transport','knowledge','animals','medical')),
  label_he    text    not null,
  icon_name   text    not null,
  sort_order  integer not null,
  is_active   boolean not null default true
);

alter table public.donation_categories enable row level security;

create policy donation_categories_select_all on public.donation_categories
  for select using (true);

insert into public.donation_categories (slug, label_he, icon_name, sort_order, is_active) values
  ('time',      'זמן',     'time-outline',         1, true),
  ('money',     'כסף',     'cash-outline',         2, true),
  ('food',      'אוכל',    'restaurant-outline',   3, true),
  ('housing',   'דיור',    'home-outline',         4, true),
  ('transport', 'תחבורה',  'car-outline',          5, true),
  ('knowledge', 'ידע',     'school-outline',       6, true),
  ('animals',   'חיות',    'paw-outline',          7, true),
  ('medical',   'רפואה',   'medical-outline',      8, true)
on conflict (slug) do nothing;

-- ── 2. donation_links ────────────────────────────────────────────────────────
create table if not exists public.donation_links (
  id              uuid primary key default gen_random_uuid(),
  category_slug   text not null references public.donation_categories(slug),
  url             text not null
    check (url ~* '^https?://'),
  display_name    text not null
    check (char_length(display_name) between 2 and 80),
  description     text
    check (description is null or char_length(description) <= 280),
  submitted_by    uuid not null references auth.users(id) on delete cascade,
  validated_at    timestamptz not null,
  hidden_at       timestamptz,
  hidden_by       uuid references auth.users(id),
  created_at      timestamptz not null default now()
);

create index donation_links_category_visible_idx
  on public.donation_links (category_slug, created_at desc)
  where hidden_at is null;

create index donation_links_submitted_by_idx
  on public.donation_links (submitted_by);

alter table public.donation_links enable row level security;

-- SELECT: authenticated users see visible rows + their own + super-admin sees all.
create policy donation_links_select_visible on public.donation_links
  for select to authenticated using (
    hidden_at is null
    or submitted_by = auth.uid()
    or exists (
      select 1 from public.users u
      where u.user_id = auth.uid() and u.is_super_admin = true
    )
  );

-- INSERT: blocked for client roles. Only the Edge Function (service-role) inserts.
-- (No INSERT policy = nothing satisfies it for authenticated/anon.)

-- UPDATE: submitter on own row, or super-admin on any row. Used to soft-hide.
create policy donation_links_update_own_or_admin on public.donation_links
  for update to authenticated using (
    submitted_by = auth.uid()
    or exists (
      select 1 from public.users u
      where u.user_id = auth.uid() and u.is_super_admin = true
    )
  ) with check (
    submitted_by = auth.uid()
    or exists (
      select 1 from public.users u
      where u.user_id = auth.uid() and u.is_super_admin = true
    )
  );

-- DELETE: same authorization as UPDATE. (Used when user wants to permanently remove
-- their own row instead of soft-hiding it.)
create policy donation_links_delete_own_or_admin on public.donation_links
  for delete to authenticated using (
    submitted_by = auth.uid()
    or exists (
      select 1 from public.users u
      where u.user_id = auth.uid() and u.is_super_admin = true
    )
  );
