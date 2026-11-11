-- 0146_rpc_ride_update_visibility.sql — FR-RIDE-020 owner updates visibility on existing ride.
--
-- After 0145 the read/join paths honor all three tiers, but the only way to
-- change a ride's visibility was a raw UPDATE (allowed by the existing
-- ride_listings_update_own policy from 0122). Wrapping the update in an RPC
-- mirrors the pattern used elsewhere (close/cancel goes via the application
-- layer; participants go via SECURITY DEFINER) and gives us a single audit
-- point for visibility transitions if we ever want to log them.
--
-- Validation:
--   * Caller authenticated and is the ride owner.
--   * Target row is status='open' (closed/cancelled/expired rides cannot
--     change visibility; their owner can re-publish a new ride if needed).
--   * p_visibility ∈ {Public, FollowersOnly, OnlyMe}.

BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_ride_update_visibility(
  p_ride_id    uuid,
  p_visibility text
)
RETURNS public.ride_listings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.ride_listings;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = 'P0001';
  END IF;

  IF p_visibility NOT IN ('Public','FollowersOnly','OnlyMe') THEN
    RAISE EXCEPTION 'invalid_visibility' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row
    FROM public.ride_listings
   WHERE ride_id = p_ride_id
   FOR UPDATE;
  IF v_row.ride_id IS NULL THEN
    RAISE EXCEPTION 'ride_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_row.owner_id <> v_uid THEN
    RAISE EXCEPTION 'not_ride_owner' USING ERRCODE = 'P0001';
  END IF;
  IF v_row.status <> 'open' THEN
    RAISE EXCEPTION 'ride_not_open' USING ERRCODE = 'P0001';
  END IF;

  IF v_row.visibility = p_visibility THEN
    RETURN v_row;
  END IF;

  UPDATE public.ride_listings
     SET visibility = p_visibility
   WHERE ride_id = p_ride_id
  RETURNING * INTO v_row;

  RETURN v_row;
END $$;

GRANT EXECUTE ON FUNCTION public.rpc_ride_update_visibility(uuid, text) TO authenticated;

COMMIT;
