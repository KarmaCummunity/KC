-- 0352_drop_create_marketplace_listing_v1 | follow-up to #953
-- 0321 created create_marketplace_listing with 9 params; 0334 added a 13-param
-- version (geo, radius, media paths) alongside it rather than replacing it.
-- Two overloads with all-default trailing params make PostgREST/Postgres calls that
-- only use the shared params ambiguous. The only app caller
-- (SupabaseMarketplaceRepository.createListing) and the SQL tests use the 13-param
-- version, so drop the old one.

begin;

drop function if exists public.create_marketplace_listing(
  uuid, text, text, jsonb, text, uuid, text, smallint, text
);

commit;
