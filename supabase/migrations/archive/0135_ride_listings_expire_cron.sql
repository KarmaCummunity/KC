-- 0135_ride_listings_expire_cron.sql — FR-RIDE-002 backend hardening.
--
-- Auto-expire `open` rides whose departure is in the past. Without this,
-- the rides feed accumulates listings whose `departs_at` has already passed
-- and that nobody is bothering to close manually. The visible feed still
-- only shows `status = 'open'` rows (via ride_listings_search), so flipping
-- stale rows to `'expired'` is what drops them from results.
--
-- Design choices:
--   * Expiry window: 3 hours after `departs_at`. A ride is "happening" up
--     until departure; we keep it visible for a small grace period after
--     so a same-day search doesn't lose entries the instant the clock
--     ticks over. After 3 hours the ride is certainly historical.
--   * Cron cadence: every 15 minutes. The feed should not show entries
--     more than ~3h15m past their departure.
--   * No owner notification on expiry: rides have a known happen-time, so
--     a 3-hours-after-departure ping has no actionable value. (Posts get a
--     7-day-prior warning because their 300-day expiry is far from any
--     natural action point.)
--   * No new index. The partial index `ride_listings_open_depart_idx`
--     (status='open', sorted by departs_at ASC) already serves the scan.

BEGIN;

ALTER TABLE public.ride_listings
  DROP CONSTRAINT ride_listings_status_check;

ALTER TABLE public.ride_listings
  ADD CONSTRAINT ride_listings_status_check
  CHECK (status IN ('open','closed','cancelled','expired'));

CREATE OR REPLACE FUNCTION public.ride_listings_expire_check()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH expired AS (
    UPDATE public.ride_listings
       SET status = 'expired'
     WHERE status = 'open'
       AND departs_at + interval '3 hours' <= now()
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_count FROM expired;
  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION public.ride_listings_expire_check() FROM public;
GRANT EXECUTE ON FUNCTION public.ride_listings_expire_check() TO service_role;

-- Unschedule any previous registration before re-registering (idempotent).
SELECT cron.unschedule('ride_listings_expire_check')
  WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'ride_listings_expire_check'
  );

SELECT cron.schedule(
  'ride_listings_expire_check',
  '*/15 * * * *',
  $$ SELECT public.ride_listings_expire_check(); $$
);

COMMIT;
