-- 0397: ensure marketplace browse/search treats rides + knowledge like other worlds.
-- browse_listings already filters by world_slug; add covering index for hub feeds.

begin;

create index if not exists listings_world_open_created_idx
  on public.listings (world_slug, created_at desc)
  where status = 'open';

create index if not exists listings_rides_departs_idx
  on public.listings ((details->>'departs_at'))
  where world_slug = 'rides' and status = 'open';

commit;
