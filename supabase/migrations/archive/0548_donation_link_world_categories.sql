-- 0548_donation_link_world_categories | D100, FR-DONATE-006/008, FR-POST-001 AC6
-- The democracy, employment and challenges worlds are portals for now: their create form
-- is "add a link", so each needs a community-links category (donation_categories row).
-- The slug CHECK on donation_categories is widened accordingly; no data is removed.

begin;

alter table public.donation_categories
  drop constraint if exists donation_categories_slug_check;

alter table public.donation_categories
  add constraint donation_categories_slug_check
  check (slug in (
    'time','money','food','housing','transport','knowledge','animals','medical',
    'democracy','employment','challenges'
  ));

insert into public.donation_categories (slug, label_he, icon_name, sort_order, is_active) values
  ('democracy',  'דמוקרטיה', 'megaphone-outline', 9,  true),
  ('employment', 'תעסוקה',   'briefcase-outline', 10, true),
  ('challenges', 'אתגרים',   'trophy-outline',    11, true)
on conflict (slug) do nothing;

commit;
