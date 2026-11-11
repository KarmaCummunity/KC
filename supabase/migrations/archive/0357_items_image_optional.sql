-- 0357_items_image_optional | product decision (Nave): item listings do NOT need an image.
-- Removes the items image requirement added in 0266 and moved to deferred constraint
-- triggers in 0351:
--   * drops listings_items_image_required_ins / _upd (listings) and
--     listing_media_items_image_required_del (blocked deleting the last photo),
--   * drops their trigger function public.listings_items_image_check().
-- listings_enforce_world_rules (as of 0351) no longer checks images, so all other world
-- rules stay unchanged: food expiry, external body for medical/animals/environment,
-- ride cost cap, money campaign cap, matchmaking age, items default 30-day expiry.
-- image_url / image_path stay allowed in the items detail schemas (back-compat, 0351).

begin;

drop trigger if exists listings_items_image_required_ins on public.listings;
drop trigger if exists listings_items_image_required_upd on public.listings;
drop trigger if exists listing_media_items_image_required_del on public.listing_media;

drop function if exists public.listings_items_image_check();

commit;
