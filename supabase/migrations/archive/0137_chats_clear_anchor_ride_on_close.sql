-- 0137_chats_clear_anchor_ride_on_close.sql — FR-RIDE-002 backend hardening.
--
-- When a ride leaves the `open` state — user-driven close/cancel via
-- CloseRideListingUseCase, or system-driven expiry via the cron in
-- 0135_ride_listings_expire_cron — any chat that pointed at that ride
-- via `chats.anchor_ride_id` still holds the stale FK. The row itself
-- is intact (the FK is `ON DELETE SET NULL`, not `ON UPDATE`), so the
-- chat's "anchored ride" reference just goes silently wrong.
--
-- Mirror what 0026_chat_anchor_lifecycle does for posts: clear the
-- anchor in every chat that pointed to the just-closed ride, so future
-- contact-rider flows can re-anchor cleanly and the chat thread reflects
-- that this ride is no longer the live context.
--
-- Scope:
--   * Trigger fires on UPDATE ride_listings when status leaves 'open'.
--   * Only clears anchor_ride_id; does NOT emit a system message in this
--     pass. System messages are user-visible and the rides UI is
--     temporarily hidden — adding them here would surface ride context
--     in chats with nowhere to navigate. A follow-up can add them once
--     the UI is back.

BEGIN;

CREATE OR REPLACE FUNCTION public.ride_listings_clear_chat_anchor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.status = 'open' AND NEW.status <> 'open' THEN
    UPDATE public.chats
       SET anchor_ride_id = NULL
     WHERE anchor_ride_id = NEW.ride_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_ride_listings_clear_chat_anchor ON public.ride_listings;

CREATE TRIGGER tg_ride_listings_clear_chat_anchor
  AFTER UPDATE OF status ON public.ride_listings
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.ride_listings_clear_chat_anchor();

COMMIT;
