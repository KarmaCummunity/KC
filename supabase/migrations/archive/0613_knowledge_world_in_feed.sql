-- 0613_knowledge_world_in_feed | FR-FEED-020 AC1 · supersedes the knowledge part of D-218 · PM decision 2026-11-04
--
-- Knowledge listings (courses, private lessons, mentorship requests) reach the main feed like every
-- other world, without the owner having to share them. Until now knowledge was the one world that
-- did not mirror (D-218): its listings got a post kept out of the feed (`posts.feed_hidden`) until
-- the owner tapped "share to feed". This migration:
--
--   1. turns `worlds.feed_mirror` on for knowledge, so a published knowledge listing's post is
--      listed from the moment moderation publishes it (R-Knowledge-1 still holds new listings
--      in `pending_review`);
--   2. lists the posts of knowledge listings that are already published and open (the same
--      upsert "share to feed" runs; a failing listing is reported and skipped).
--
-- Later ride occurrences stay hidden until they are the soonest (FR-RIDE-046); that is unchanged.

begin;

update public.worlds set feed_mirror = true where slug = 'knowledge';

do $$
declare
  r public.listings%rowtype;
begin
  for r in
    select l.*
      from public.listings l
     where l.world_slug = 'knowledge'
       and l.origin = 'native'
       and l.status = 'open'
       and l.moderation_status = 'published'
     order by l.created_at
  loop
    begin
      perform public.listing_feed_mirror_upsert(r);
    exception when others then
      raise warning 'knowledge_world_in_feed backfill: listing % skipped: %', r.listing_id, sqlerrm;
    end;
  end loop;
end $$;

commit;
