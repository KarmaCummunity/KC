-- 0360_money_ui_schema | Public nonprofit pages + campaign linkage (Issue #850 UI stack).

begin;

alter table public.organizations
  add column if not exists public_tagline_he text,
  add column if not exists public_tagline_en text,
  add column if not exists public_about_he text,
  add column if not exists public_about_en text;

alter table public.listings
  add column if not exists beneficiary_org_id uuid references public.organizations(org_id) on delete set null;

create index if not exists listings_beneficiary_org_idx
  on public.listings (beneficiary_org_id)
  where beneficiary_org_id is not null and world_slug = 'money';

comment on column public.listings.beneficiary_org_id is
  'Verified nonprofit receiving funds for money-world campaign listings.';

commit;
