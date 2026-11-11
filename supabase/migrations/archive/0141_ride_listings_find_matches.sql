-- 0141_ride_listings_find_matches.sql — FR-RIDE-014 inverse-mode matches RPC.
--
-- When a user publishes an offer, the natural follow-up question is "is anyone
-- already looking for this route, around this time?" — and vice-versa for a
-- request. This RPC answers it without forcing the client to redo the whole
-- search dance with inverted filters.
--
-- Match definition (V1):
--   * Inverse mode: offer ↔ request.
--   * Origin city of one == origin city of the other (riders/drivers share start).
--   * Dest city of one == dest city of the other.
--   * Both rides are status='open' and visibility='Public'.
--   * departs_at within ±N hours of the source ride (default 12; clamped 1..72).
--   * Caller is authenticated and either owns the source ride OR the source ride
--     is visible to them via RLS. (For V1 we only allow owner queries so we don't
--     reveal request-rider matches across users.)
--
-- Sort: absolute time difference from source.departs_at, ascending; ties break by
-- inserted_at descending so newer matches surface first.

BEGIN;

CREATE OR REPLACE FUNCTION public.ride_listings_find_matches(
  p_ride_id      uuid,
  p_window_hours int DEFAULT 12,
  p_limit        int DEFAULT 20
)
RETURNS SETOF public.ride_listings
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_src    public.ride_listings;
  v_window interval;
  v_limit  int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_src
    FROM public.ride_listings
   WHERE ride_id = p_ride_id;
  IF v_src.ride_id IS NULL THEN
    RAISE EXCEPTION 'ride_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_src.owner_id <> v_uid THEN
    RAISE EXCEPTION 'not_ride_owner' USING ERRCODE = 'P0001';
  END IF;

  v_window := make_interval(hours => LEAST(GREATEST(coalesce(p_window_hours, 12), 1), 72));
  v_limit  := LEAST(GREATEST(coalesce(p_limit, 20), 1), 50);

  RETURN QUERY
  SELECT r.*
    FROM public.ride_listings r
   WHERE r.ride_id        <> v_src.ride_id
     AND r.status         = 'open'
     AND r.visibility     = 'Public'
     AND r.mode           <> v_src.mode
     AND r.origin_city_id = v_src.origin_city_id
     AND r.dest_city_id   = v_src.dest_city_id
     AND r.departs_at BETWEEN v_src.departs_at - v_window
                          AND v_src.departs_at + v_window
   ORDER BY abs(extract(epoch from (r.departs_at - v_src.departs_at))) ASC,
            r.created_at DESC
   LIMIT v_limit;
END $$;

GRANT EXECUTE ON FUNCTION public.ride_listings_find_matches(uuid, int, int) TO authenticated;

COMMIT;
