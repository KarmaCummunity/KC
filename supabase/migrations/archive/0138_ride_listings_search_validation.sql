-- 0138_ride_listings_search_validation.sql — FR-RIDE-002 backend hardening.
--
-- Harden `ride_listings_search` against malformed inputs. Previously the
-- function silently returned an empty set when the caller passed an
-- inverted date range or other degenerate filters, which hid bugs from
-- both the client (no error, just no results) and operators (no log).
--
-- This rewrite:
--   * Switches from LANGUAGE sql to LANGUAGE plpgsql so we can RAISE on
--     invalid inputs and short-circuit before scanning the index.
--   * Rejects p_depart_from > p_depart_to with errcode 22023 (invalid
--     parameter value), the SQL standard code for bad arg combinations.
--   * Bounds p_limit defensively at the DB layer (LEAST/GREATEST was
--     already present; we keep the inline clamp so the server is the
--     source of truth even if a future adapter forgets).
--   * Caps query length at 80 chars to bound ILIKE scan cost. Inputs
--     longer than that are unlikely from the UI (the search bar truncates
--     anyway) but a hostile caller can push pathological ILIKE expansion.
--   * Documents the existing < 2-char query short-circuit.
--
-- Behavior preserved:
--   * Function returns SETOF public.ride_listings — unchanged signature.
--   * Result ordering: departs_at ASC.
--   * Visibility filter: only Public, status = 'open'.

BEGIN;

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

  -- Query: trim, drop very-short inputs to the "no text filter" path,
  -- and cap at 80 chars to bound ILIKE expansion cost.
  v_query := NULLIF(trim(coalesce(p_query, '')), '');
  IF v_query IS NOT NULL AND char_length(v_query) < 2 THEN
    v_query := NULL;
  END IF;
  IF v_query IS NOT NULL AND char_length(v_query) > 80 THEN
    v_query := substr(v_query, 1, 80);
  END IF;

  -- Limit clamp: [1, 50]. The existing client default is 30.
  v_limit := LEAST(GREATEST(coalesce(p_limit, 30), 1), 50);

  RETURN QUERY
  SELECT r.*
    FROM public.ride_listings r
    LEFT JOIN public.cities oc ON oc.city_id = r.origin_city_id
    LEFT JOIN public.cities dc ON dc.city_id = r.dest_city_id
   WHERE r.status = 'open'
     AND r.visibility = 'Public'
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

COMMIT;
