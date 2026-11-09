-- 0700_listing_detail_legacy_listing_id | KC#2032 (FR-POST-014..018, FR-FEED-001, G1 step 6d).
--
-- The post screen of a listing-world post opens the detail with `post.listingId`, the id the post's
-- listing had before step 6d (`posts.listing_id`). Since 0667 `listings` is a view keyed on the post
-- id, and `handoff_target_listing_id` found nothing for that former id, so
-- `get_marketplace_listing_detail` returned null and the screen showed "listing not found".
-- Every reader that normalises an id through this helper had the same blind spot (handoff targets,
-- the detail), so the fix is here and nowhere else.
--
-- An id now resolves, in order, as:
--   1. a post id (what the `listings` view calls a listing id), or
--   2. a former listing id, through `posts.listing_id`, to that post's id.
-- Unknown ids still resolve to null. Signature, volatility and grants are unchanged.

begin;

create or replace function public.handoff_target_listing_id(p_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select l.listing_id from public.listings l where l.listing_id = p_id),
    -- 0700: a post created before step 6d is still addressed by its former listing id.
    (select p.post_id from public.posts p where p.listing_id = p_id));
$$;

comment on function public.handoff_target_listing_id(uuid) is
  'Resolves a post id or a former listing id (posts.listing_id) to the id the listings view uses (0700).';

commit;
