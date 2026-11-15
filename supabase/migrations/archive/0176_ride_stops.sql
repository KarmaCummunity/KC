-- 0176_ride_stops.sql — FR-RIDE-030 intermediate stops.
--
-- Up to 3 stops per ride; each is a (city + optional street + optional notes)
-- with sort_order. Owner-only RLS. Insert/update/delete go through the owner
-- directly (no RPC needed — RLS suffices since stops cascade-delete with the
-- ride, and there are no cross-row invariants like seat capacity).

BEGIN;

CREATE TABLE public.ride_stops (
  stop_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id      uuid NOT NULL REFERENCES public.ride_listings(ride_id) ON DELETE CASCADE,
  sort_order   int  NOT NULL CHECK (sort_order BETWEEN 1 AND 3),
  city_id      text NOT NULL REFERENCES public.cities(city_id),
  street       text NULL CHECK (street IS NULL OR char_length(street) <= 80),
  notes        text NULL CHECK (notes IS NULL OR char_length(notes) <= 200),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ride_id, sort_order),
  -- Cannot duplicate the same city as another stop on the same ride.
  UNIQUE (ride_id, city_id)
);

CREATE INDEX ride_stops_ride_idx ON public.ride_stops (ride_id, sort_order);

ALTER TABLE public.ride_stops ENABLE ROW LEVEL SECURITY;

-- SELECT: visible to anyone who can see the parent ride.
CREATE POLICY ride_stops_select ON public.ride_stops
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.ride_listings r
      WHERE r.ride_id = public.ride_stops.ride_id
        AND (
          r.owner_id = auth.uid()
          OR (
            r.status = 'open'
            AND (
              r.visibility = 'Public'
              OR (r.visibility = 'FollowersOnly' AND public.is_following(auth.uid(), r.owner_id))
            )
          )
        )
    )
  );

-- INSERT/UPDATE/DELETE: owner only.
CREATE POLICY ride_stops_insert_own ON public.ride_stops
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.ride_listings r
      WHERE r.ride_id = public.ride_stops.ride_id
        AND r.owner_id = auth.uid()
    )
  );

CREATE POLICY ride_stops_update_own ON public.ride_stops
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.ride_listings r
      WHERE r.ride_id = public.ride_stops.ride_id
        AND r.owner_id = auth.uid()
    )
  );

CREATE POLICY ride_stops_delete_own ON public.ride_stops
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.ride_listings r
      WHERE r.ride_id = public.ride_stops.ride_id
        AND r.owner_id = auth.uid()
    )
  );

-- A small trigger to prevent inserting a stop whose city duplicates the
-- parent ride's origin or destination city (FR-RIDE-030 AC4).
CREATE OR REPLACE FUNCTION public.ride_stops_check_distinct_from_endpoints()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_origin text;
  v_dest   text;
BEGIN
  SELECT origin_city_id, dest_city_id INTO v_origin, v_dest
    FROM public.ride_listings WHERE ride_id = NEW.ride_id;
  IF NEW.city_id = v_origin OR NEW.city_id = v_dest THEN
    RAISE EXCEPTION 'stop_matches_endpoint'
      USING ERRCODE = 'P0001',
            HINT    = 'A stop city must differ from the origin and destination cities';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_ride_stops_check_endpoints ON public.ride_stops;
CREATE TRIGGER tg_ride_stops_check_endpoints
  BEFORE INSERT OR UPDATE OF city_id ON public.ride_stops
  FOR EACH ROW
  EXECUTE FUNCTION public.ride_stops_check_distinct_from_endpoints();

COMMIT;
