-- 0127_ride_listing_streets.sql — FR-RIDE-003 full address (city + street, optional house number)

ALTER TABLE public.ride_listings
  ADD COLUMN origin_street text NOT NULL DEFAULT '—' CHECK (char_length(origin_street) BETWEEN 1 AND 80),
  ADD COLUMN origin_street_number text CHECK (
    origin_street_number IS NULL OR char_length(origin_street_number) BETWEEN 1 AND 20
  ),
  ADD COLUMN dest_street text NOT NULL DEFAULT '—' CHECK (char_length(dest_street) BETWEEN 1 AND 80),
  ADD COLUMN dest_street_number text CHECK (
    dest_street_number IS NULL OR char_length(dest_street_number) BETWEEN 1 AND 20
  );

ALTER TABLE public.ride_listings ALTER COLUMN origin_street DROP DEFAULT;
ALTER TABLE public.ride_listings ALTER COLUMN dest_street DROP DEFAULT;

-- Relax city-only constraint: allow same city when streets differ.
ALTER TABLE public.ride_listings DROP CONSTRAINT IF EXISTS ride_listings_origin_dest_diff;

ALTER TABLE public.ride_listings
  ADD CONSTRAINT ride_listings_route_distinct_chk CHECK (
    origin_city_id <> dest_city_id
    OR origin_street <> dest_street
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
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
      p_query IS NULL OR char_length(trim(p_query)) < 2
      OR r.title ILIKE '%' || replace(replace(trim(p_query), '%', '\%'), '_', '\_') || '%'
      OR r.description ILIKE '%' || replace(replace(trim(p_query), '%', '\%'), '_', '\_') || '%'
      OR oc.name_he ILIKE '%' || replace(replace(trim(p_query), '%', '\%'), '_', '\_') || '%'
      OR dc.name_he ILIKE '%' || replace(replace(trim(p_query), '%', '\%'), '_', '\_') || '%'
      OR r.origin_street ILIKE '%' || replace(replace(trim(p_query), '%', '\%'), '_', '\_') || '%'
      OR r.dest_street ILIKE '%' || replace(replace(trim(p_query), '%', '\%'), '_', '\_') || '%'
    )
  ORDER BY r.departs_at ASC
  LIMIT LEAST(GREATEST(p_limit, 1), 50);
$$;
