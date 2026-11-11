-- 0145_ride_listings_visibility_tiers.sql — FR-RIDE-018 honor visibility tiers.
--
-- V2.0 always created rides with visibility='Public' (FR-RIDE-007) and the
-- search RPC + SELECT policy only respected that single tier. The schema has
-- always supported FollowersOnly and OnlyMe (CHECK constraint in 0122), so
-- the storage layer is ready — only the visibility predicates need to be
-- relaxed:
--
--   * Public         → anyone (status=open)
--   * FollowersOnly  → owner OR is_following(viewer, owner)
--   * OnlyMe         → owner only (already handled by owner_id = auth.uid())
--
-- This migration:
--   1. Rewrites the SELECT RLS policy to thread is_following through.
--   2. Rewrites ride_listings_search to widen the visibility predicate the
--      same way, since the RPC is SECURITY DEFINER and bypasses RLS — the
--      function body is the source of truth for what's visible in search
--      results.

BEGIN;

DROP POLICY IF EXISTS ride_listings_select_visible ON public.ride_listings;

CREATE POLICY ride_listings_select_visible ON public.ride_listings
  FOR SELECT TO authenticated
  USING (
    owner_id = auth.uid()
    OR (
      status = 'open'
      AND (
        visibility = 'Public'
        OR (visibility = 'FollowersOnly' AND public.is_following(auth.uid(), owner_id))
      )
    )
  );

CREATE OR REPLACE FUNCTION public.ride_listings_search(
  p_query text DEFAULT NULL,
  p_origin_city_id text DEFAULT NULL,
  p_dest_city_id text DEFAULT NULL,
  p_mode text DEFAULT NULL,
  p_depart_from timestamptz DEFAULT NULL,
  p_depart_to timestamptz DEFAULT NULL,
  p_limit int DEFAULT 30,
  p_cursor timestamptz DEFAULT NULL
)
RETURNS SETOF public.ride_listings
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_query  text;
  v_limit  int;
BEGIN
  -- Invariant: if both bounds are provided, from must precede to.
  IF p_depart_from IS NOT NULL AND p_depart_to IS NOT NULL
     AND p_depart_from > p_depart_to THEN
    RAISE EXCEPTION 'ride_listings_search: depart_from > depart_to'
      USING ERRCODE = '22023';
  END IF;

  -- Mode must be one of the two allowed values (or NULL).
  IF p_mode IS NOT NULL AND p_mode NOT IN ('offer','request') THEN
    RAISE EXCEPTION 'ride_listings_search: invalid mode %', p_mode
      USING ERRCODE = '22023';
  END IF;

  v_query := NULLIF(trim(coalesce(p_query, '')), '');
  IF v_query IS NOT NULL AND char_length(v_query) < 2 THEN
    v_query := NULL;
  END IF;
  IF v_query IS NOT NULL AND char_length(v_query) > 80 THEN
    v_query := substr(v_query, 1, 80);
  END IF;

  v_limit := LEAST(GREATEST(coalesce(p_limit, 30), 1), 50);

  RETURN QUERY
  SELECT r.*
    FROM public.ride_listings r
    LEFT JOIN public.cities oc ON oc.city_id = r.origin_city_id
    LEFT JOIN public.cities dc ON dc.city_id = r.dest_city_id
   WHERE r.status = 'open'
     -- Visibility tier check; OnlyMe never appears in search results.
     AND (
       r.visibility = 'Public'
       OR (r.visibility = 'FollowersOnly' AND public.is_following(v_uid, r.owner_id))
       OR r.owner_id = v_uid
     )
     AND (p_mode IS NULL OR r.mode = p_mode)
     AND (p_origin_city_id IS NULL OR r.origin_city_id = p_origin_city_id)
     AND (p_dest_city_id IS NULL OR r.dest_city_id = p_dest_city_id)
     AND (p_depart_from IS NULL OR r.departs_at >= p_depart_from)
     AND (p_depart_to IS NULL OR r.departs_at <= p_depart_to)
     AND (p_cursor IS NULL OR r.departs_at > p_cursor)
     AND (
       v_query IS NULL
       OR r.title ILIKE '%' || replace(replace(v_query, '%', '\%'), '_', '\_') || '%'
       OR r.description ILIKE '%' || replace(replace(v_query, '%', '\%'), '_', '\_') || '%'
       OR oc.name_he ILIKE '%' || replace(replace(v_query, '%', '\%'), '_', '\_') || '%'
       OR dc.name_he ILIKE '%' || replace(replace(v_query, '%', '\%'), '_', '\_') || '%'
       OR r.origin_street ILIKE '%' || replace(replace(v_query, '%', '\%'), '_', '\_') || '%'
       OR r.dest_street ILIKE '%' || replace(replace(v_query, '%', '\%'), '_', '\_') || '%'
     )
   ORDER BY r.departs_at ASC
   LIMIT v_limit;
END $$;

-- Widen the request-RPC joinability check the same way: FollowersOnly rides
-- are joinable by followers of the owner.
CREATE OR REPLACE FUNCTION public.rpc_ride_participants_request(
  p_ride_id uuid,
  p_note    text DEFAULT NULL
)
RETURNS public.ride_participants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_ride    public.ride_listings;
  v_row     public.ride_participants;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_ride FROM public.ride_listings WHERE ride_id = p_ride_id;
  IF v_ride.ride_id IS NULL THEN
    RAISE EXCEPTION 'ride_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_ride.status <> 'open' OR (
       v_ride.visibility <> 'Public'
       AND NOT (v_ride.visibility = 'FollowersOnly'
                AND public.is_following(v_uid, v_ride.owner_id))
     ) THEN
    RAISE EXCEPTION 'ride_not_joinable' USING ERRCODE = 'P0001';
  END IF;
  IF v_ride.owner_id = v_uid THEN
    RAISE EXCEPTION 'cannot_join_own_ride' USING ERRCODE = 'P0001';
  END IF;

  IF p_note IS NOT NULL AND char_length(p_note) > 500 THEN
    RAISE EXCEPTION 'note_too_long' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.ride_participants (ride_id, user_id, note)
  VALUES (p_ride_id, v_uid, p_note)
  RETURNING * INTO v_row;

  RETURN v_row;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'already_requested' USING ERRCODE = 'P0001';
END $$;

COMMIT;
