-- 0451_listings_anonymity_both_ways | D16 / G3
-- docs/spec/07_cross_cutting_systems.md §7.13: anonymity is chosen in the
-- form and changeable both ways. 0242 only let a published listing become
-- more anonymous (`anonymity_loosen_forbidden`); posts already allow both
-- directions since 0094. Owner-only writes stay enforced by RLS.

begin;

drop trigger if exists listings_anonymity_tighten_only_trg on public.listings;
drop function if exists public.listings_anonymity_tighten_only();

commit;
