-- 0180_driver_declarations.sql — FR-RIDE-041 driver license + insurance declaration.
--
-- Before a user can publish a `mode='offer'` ride for the first time, they
-- must accept three legal declarations:
--   * They hold a valid driver's license (R-Rides-3).
--   * Their vehicle has current insurance (R-Rides-4, declaration only).
--   * They acknowledge the no-profit rule (R-Rides-1).
--
-- The acceptance is recorded once and applies to all future offers.
-- A BEFORE INSERT trigger on ride_listings enforces the gate.

BEGIN;

CREATE TABLE public.driver_declarations (
  user_id              uuid PRIMARY KEY REFERENCES public.users(user_id) ON DELETE CASCADE,
  declared_at          timestamptz NOT NULL DEFAULT now(),
  license_declared     boolean NOT NULL,
  insurance_declared   boolean NOT NULL,
  no_profit_acknowledged boolean NOT NULL,
  CONSTRAINT driver_declarations_all_true CHECK (
    license_declared = true
    AND insurance_declared = true
    AND no_profit_acknowledged = true
  )
);

ALTER TABLE public.driver_declarations ENABLE ROW LEVEL SECURITY;

-- SELECT/INSERT: owner-only. UPDATE/DELETE: revoked (use a fresh row on
-- legal change; for revocation contact support).
CREATE POLICY driver_declarations_select_self ON public.driver_declarations
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY driver_declarations_insert_self ON public.driver_declarations
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

REVOKE UPDATE, DELETE ON public.driver_declarations FROM authenticated, anon;

-- ---------------------------------------------------------------------------
-- BEFORE INSERT trigger on ride_listings — when mode='offer', require a
-- declaration row to exist for owner_id.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ride_listings_require_driver_declaration()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.mode = 'offer' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.driver_declarations WHERE user_id = NEW.owner_id
    ) THEN
      RAISE EXCEPTION 'declaration_required'
        USING ERRCODE = 'P0001',
              HINT    = 'Driver must accept R-Rides-1/3/4 declarations before publishing an offer';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_ride_listings_require_driver_declaration ON public.ride_listings;
CREATE TRIGGER tg_ride_listings_require_driver_declaration
  BEFORE INSERT ON public.ride_listings
  FOR EACH ROW
  EXECUTE FUNCTION public.ride_listings_require_driver_declaration();

COMMIT;
