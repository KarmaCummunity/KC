-- 0320_marketplace_unified_model | Epic #893 / #903
-- Unified marketplace facets on public.listings (all donation_worlds share one row shape).

begin;

alter table public.listings
  add column if not exists urgency_level smallint not null default 2
    check (urgency_level between 1 and 3),
  add column if not exists availability_status text not null default 'ongoing'
    check (availability_status in ('immediate', 'scheduled', 'ongoing'));

comment on column public.listings.urgency_level is
  '1=low, 2=normal, 3=urgent (PRD marketplace filters).';
comment on column public.listings.availability_status is
  'Fulfillment timing hint for browse/map filters.';

create index if not exists listings_browse_open_idx
  on public.listings (world_slug, direction, urgency_level desc, created_at desc)
  where status = 'open' and moderation_status = 'published';

create or replace view public.marketplace_listing_card
with (security_invoker = true) as
select
  l.listing_id,
  l.owner_id,
  l.world_slug,
  w.label_he as world_label_he,
  w.label_en as world_label_en,
  l.kind_id,
  lk.slug as kind_slug,
  lk.label_he as kind_label_he,
  lk.label_en as kind_label_en,
  l.category_id,
  l.direction,
  l.status,
  l.visibility,
  l.anonymity_level,
  l.title,
  l.summary,
  l.geo,
  l.city_id,
  l.time_window,
  l.expires_at,
  l.details,
  l.origin,
  l.legacy_post_id,
  l.legacy_ride_id,
  l.urgency_level,
  l.availability_status,
  l.published_at,
  l.created_at,
  l.updated_at
from public.listings l
join public.worlds w on w.slug = l.world_slug
join public.listing_kinds lk on lk.kind_id = l.kind_id;

grant select on public.marketplace_listing_card to anon, authenticated, service_role;

commit;
