-- 0144_ride_participants_expire_stale.sql — FR-RIDE-017 auto-cancel stale requested rows.
--
-- A request that's still 'requested' after the ride has already departed is
-- dead weight: the rider never got approved and the ride no longer exists as
-- an open seat. Auto-cancel them so:
--   * Owner dashboards aren't cluttered with phantom pending decisions.
--   * Rider's "my requests" view shows a clean terminal state.
--
-- Cadence matches the ride-listings expire cron (every 15 minutes; see 0135).
-- We deliberately mark `decided_by = NULL` to signal "system-cancelled" — the
-- ride_participants_decided_consistency CHECK only requires decided_at to be
-- set on non-requested rows, so this is valid.
--
-- The decision-notification trigger from 0140 ignores requested → cancelled
-- transitions (only approved → cancelled fires the owner ping), so this sweep
-- is silent on the user-visible side.

BEGIN;

CREATE OR REPLACE FUNCTION public.ride_participants_expire_stale_check()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH stale AS (
    UPDATE public.ride_participants rp
       SET status      = 'cancelled',
           decided_at  = now(),
           decided_by  = NULL
      FROM public.ride_listings r
     WHERE r.ride_id = rp.ride_id
       AND rp.status = 'requested'
       AND r.departs_at + interval '3 hours' <= now()
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_count FROM stale;
  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION public.ride_participants_expire_stale_check() FROM public;
GRANT EXECUTE ON FUNCTION public.ride_participants_expire_stale_check() TO service_role;

-- Unschedule a previous registration (idempotent).
SELECT cron.unschedule('ride_participants_expire_stale_check')
  WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'ride_participants_expire_stale_check'
  );

SELECT cron.schedule(
  'ride_participants_expire_stale_check',
  '*/15 * * * *',
  $$ SELECT public.ride_participants_expire_stale_check(); $$
);

COMMIT;
