-- Worlds · every world's posts reach the main feed; knowledge and challenges are active
--
-- PM decision ({{D:worlds-main-feed-and-launch}}, docs/spec/90_decisions_log.md):
--   * The main feed shows the posts of every giving world, narrowed by the member's search,
--     filters, sort and the recommendation mechanism. `worlds.shows_in_main_feed` is on for all.
--   * Knowledge and challenges are active giving worlds in every environment.
--   * Housing, animals and employment are switched per environment by the super admin from the
--     admin portal (#2277); medical, democracy and money stay portals. This file leaves them as
--     they are.
-- The reference seed creates a flag only when it is missing and never changes a world's main-feed
-- setting, so a deployed database takes these values from this migration. Rows are touched only
-- when they differ, so a database already set this way is unchanged.
update public.worlds
   set shows_in_main_feed = true
 where not shows_in_main_feed;

update public.app_flags
   set enabled = true
 where key in ('world_knowledge_enabled', 'world_challenges_enabled')
   and not enabled;
