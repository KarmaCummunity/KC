-- 0182_ride_edge_cases.sql — FR-RIDE-045 edge cases catalog.
--
-- Adds three handlers from PRD §15:
--   1. `food_handover_to_org` column on ride_listings (R-Rides-10) — driver
--      flags when an overdue food shipment was handed off to a regional food
--      org rather than the original recipient.
--   2. Forward-compat international rides guard on `rpc_ride_create`
--      (currently dormant — `ride_listings_origin_dest_diff` + the cities
--      catalog being IL-only mean every ride is intra-IL; this is the
--      backstop for when the cities catalog opens up).
--   3. Daily cron `ride_food_overdue_alert` — flags food rides 2h past
--      their `departs_at` for super-admin review (placeholder logger
--      output — the admin portal can pick it up via the existing
--      ride_emergency_events surface or a future food-overdue table).

BEGIN;

-- ---------------------------------------------------------------------------
-- (1) food_handover_to_org column.
-- ---------------------------------------------------------------------------
ALTER TABLE public.ride_listings
  ADD COLUMN food_handover_to_org boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.ride_listings.food_handover_to_org IS
  'FR-RIDE-045 AC2 — driver flags food shipment was handed off to a regional food org after overdue window.';

-- ---------------------------------------------------------------------------
-- (2) International-rides guard. Cities catalog is IL-only today; trigger
--     fires only when both endpoints carry a non-IL `country_code` column
--     IF that column exists. We defensively check via to_regclass.
-- ---------------------------------------------------------------------------
-- The current `cities` table doesn't have a country_code column. This
-- migration creates an empty placeholder column ONLY if it's missing AND
-- defaults it to 'IL' (so existing rows look IL). When/if the catalog
-- adds non-IL cities, the column already exists and the trigger fires.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'cities' AND column_name = 'country_code'
  ) THEN
    EXECUTE 'ALTER TABLE public.cities ADD COLUMN country_code text NOT NULL DEFAULT ''IL'' CHECK (char_length(country_code) = 2)';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.ride_listings_check_no_international()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_origin_country text;
  v_dest_country   text;
BEGIN
  SELECT country_code INTO v_origin_country FROM public.cities WHERE city_id = NEW.origin_city_id;
  SELECT country_code INTO v_dest_country   FROM public.cities WHERE city_id = NEW.dest_city_id;
  IF (v_origin_country IS NOT NULL AND v_origin_country <> 'IL')
     OR (v_dest_country IS NOT NULL AND v_dest_country <> 'IL')
  THEN
    RAISE EXCEPTION 'international_rides_banned'
      USING ERRCODE = 'P0001',
            HINT    = 'Rides must stay within Israel (FR-RIDE-045 AC3)';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_ride_listings_check_no_international ON public.ride_listings;
CREATE TRIGGER tg_ride_listings_check_no_international
  BEFORE INSERT ON public.ride_listings
  FOR EACH ROW
  EXECUTE FUNCTION public.ride_listings_check_no_international();

-- ---------------------------------------------------------------------------
-- (3) Food overdue alert cron — runs every 30 min, RAISE NOTICE per overdue
--     food shipment so it lands in the Postgres log; the admin task creator
--     (FR-ADMIN-018) can be wired to consume this in a follow-up.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ride_food_overdue_alert()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row record;
BEGIN
  FOR v_row IN
    SELECT ride_id, owner_id, departs_at
      FROM public.ride_listings
     WHERE food_shipping_enabled = true
       AND status = 'in_transit'
       AND departs_at + interval '2 hours' < now()
       AND food_handover_to_org = false
  LOOP
    RAISE NOTICE 'ride_food_overdue ride_id=% owner=% departs_at=%',
      v_row.ride_id, v_row.owner_id, v_row.departs_at;
  END LOOP;
END $$;

SELECT cron.schedule(
  'ride_food_overdue_alert_30m',
  '*/30 * * * *',
  $$ SELECT public.ride_food_overdue_alert(); $$
);

COMMIT;
