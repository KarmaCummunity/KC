-- 0181_ride_linked_post.sql — FR-RIDE-044 cross-world items ↔ rides link.
--
-- A `mode='request'` ride may reference an item post: "I'm receiving this
-- item and need shipping from X to Y." When the linked post closes
-- (delivered or cancelled), the ride is auto-closed via trigger — the
-- shipping is no longer needed.

BEGIN;

ALTER TABLE public.ride_listings
  ADD COLUMN linked_post_id uuid NULL
    REFERENCES public.posts(post_id) ON DELETE SET NULL;

ALTER TABLE public.ride_listings
  ADD CONSTRAINT ride_listings_linked_post_mode CHECK (
    linked_post_id IS NULL OR mode = 'request'
  );

CREATE INDEX ride_listings_linked_post_idx
  ON public.ride_listings (linked_post_id)
  WHERE linked_post_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- AFTER UPDATE on posts: when a post leaves `open` (delivered/closed),
-- auto-close any linked ride request that's still `open`.
-- ---------------------------------------------------------------------------
-- Mirrors the participant cascade (FR-RIDE-019). The linked ride moves to
-- `closed` (not `cancelled`) since the underlying shipping need was
-- successfully fulfilled (or explicitly ended).
CREATE OR REPLACE FUNCTION public.posts_cascade_close_linked_rides()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.status = 'open' AND NEW.status <> 'open' THEN
    UPDATE public.ride_listings
       SET status = 'closed'
     WHERE linked_post_id = NEW.post_id
       AND status = 'open';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_posts_cascade_close_linked_rides ON public.posts;
CREATE TRIGGER tg_posts_cascade_close_linked_rides
  AFTER UPDATE OF status ON public.posts
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.posts_cascade_close_linked_rides();

COMMIT;
