-- 0175_ride_listings_advanced_columns.sql — FR-RIDE-026..029.
--
-- Adds the advanced-publish surface (cargo / food / payment / passenger
-- requirements) to `ride_listings`. Tri-layer enforcement per FR-RIDE-040
-- (the payment-cap rule R-Rides-1 / R-Rides-2): client-side input bounds,
-- domain validateRideDraft predicate, and the CHECK constraints + trigger
-- below.
--
-- Stops live in a separate table (0176_ride_stops.sql).

BEGIN;

-- ---------------------------------------------------------------------------
-- Cargo (FR-RIDE-026) — owner declares physical capacity for items.
-- ---------------------------------------------------------------------------
ALTER TABLE public.ride_listings
  ADD COLUMN cargo_enabled        boolean      NOT NULL DEFAULT false,
  ADD COLUMN cargo_max_volume_l   int          NULL,
  ADD COLUMN cargo_max_weight_kg  int          NULL,
  ADD COLUMN cargo_allowed_types  text[]       NULL;

ALTER TABLE public.ride_listings
  ADD CONSTRAINT ride_listings_cargo_consistency CHECK (
    (cargo_enabled = false
       AND cargo_max_volume_l IS NULL
       AND cargo_max_weight_kg IS NULL
       AND cargo_allowed_types IS NULL)
    OR (cargo_enabled = true
       AND cargo_max_volume_l BETWEEN 1 AND 1000
       AND cargo_max_weight_kg BETWEEN 1 AND 200
       AND cargo_allowed_types IS NOT NULL
       AND array_length(cargo_allowed_types, 1) BETWEEN 1 AND 4)
  );

-- ---------------------------------------------------------------------------
-- Food shipping (FR-RIDE-027) — distinct trip class; mutually exclusive
-- with cargo (chilled / urgent / single-handler semantics).
-- ---------------------------------------------------------------------------
ALTER TABLE public.ride_listings
  ADD COLUMN food_shipping_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN food_max_kg           int     NULL,
  ADD COLUMN food_chilled          boolean NULL;

ALTER TABLE public.ride_listings
  ADD CONSTRAINT ride_listings_food_consistency CHECK (
    (food_shipping_enabled = false
       AND food_max_kg IS NULL
       AND food_chilled IS NULL)
    OR (food_shipping_enabled = true
       AND food_max_kg BETWEEN 1 AND 50
       AND food_chilled IS NOT NULL)
  );

ALTER TABLE public.ride_listings
  ADD CONSTRAINT ride_listings_cargo_xor_food CHECK (
    NOT (cargo_enabled AND food_shipping_enabled)
  );

-- ---------------------------------------------------------------------------
-- Payment model (FR-RIDE-028 + FR-RIDE-040 — R-Rides-1, R-Rides-2).
-- ---------------------------------------------------------------------------
ALTER TABLE public.ride_listings
  ADD COLUMN payment_model      text NOT NULL DEFAULT 'free'
    CHECK (payment_model IN ('free','expense_share')),
  ADD COLUMN payment_amount_ils int  NULL;

ALTER TABLE public.ride_listings
  ADD CONSTRAINT ride_listings_payment_consistency CHECK (
    (payment_model = 'free' AND payment_amount_ils IS NULL)
    OR (payment_model = 'expense_share'
        AND payment_amount_ils BETWEEN 1 AND 70)
  );

-- The intracity sub-cap (₪20 when origin = dest city, ₪70 otherwise) can't be
-- expressed as a CHECK because the existing `ride_listings_origin_dest_diff`
-- already forbids same-city rides; for V3.0 we therefore enforce the absolute
-- ₪70 cap at the CHECK layer and the intracity rule is reserved for a future
-- migration if `ride_listings_origin_dest_diff` is ever relaxed (intra-city
-- short hops). The trigger below is a forward-compat guard.
CREATE OR REPLACE FUNCTION public.ride_listings_payment_cap_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Intercity absolute cap is already enforced by the CHECK constraint above.
  -- This trigger catches future intra-city rides (when the same-city CHECK
  -- relaxes) and enforces the ₪20 sub-cap there.
  IF NEW.payment_model = 'expense_share'
     AND NEW.payment_amount_ils IS NOT NULL
     AND NEW.origin_city_id = NEW.dest_city_id
     AND NEW.payment_amount_ils > 20
  THEN
    RAISE EXCEPTION 'payment_cap_exceeded'
      USING ERRCODE = 'P0001',
            HINT    = 'Intracity rides cap participation at ₪20 per seat (R-Rides-2)';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_ride_listings_payment_cap ON public.ride_listings;
CREATE TRIGGER tg_ride_listings_payment_cap
  BEFORE INSERT OR UPDATE OF payment_model, payment_amount_ils ON public.ride_listings
  FOR EACH ROW
  EXECUTE FUNCTION public.ride_listings_payment_cap_trigger();

-- ---------------------------------------------------------------------------
-- Passenger requirements (FR-RIDE-029).
-- ---------------------------------------------------------------------------
ALTER TABLE public.ride_listings
  ADD COLUMN req_gender            text    NOT NULL DEFAULT 'any'
    CHECK (req_gender IN ('any','women_only','men_only')),
  ADD COLUMN req_smoking_allowed   boolean NOT NULL DEFAULT false,
  ADD COLUMN req_pets_allowed      boolean NOT NULL DEFAULT false,
  ADD COLUMN req_verified_only     boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- Extend rpc_ride_participants_request to enforce req_verified_only
-- (FR-RIDE-029 AC3).
-- ---------------------------------------------------------------------------
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
  v_uid             uuid := auth.uid();
  v_ride            public.ride_listings;
  v_row             public.ride_participants;
  v_caller_status   text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_ride FROM public.ride_listings WHERE ride_id = p_ride_id;
  IF v_ride.ride_id IS NULL THEN
    RAISE EXCEPTION 'ride_not_found' USING ERRCODE = 'P0001';
  END IF;
  -- Visibility tiers honored end-to-end (FR-RIDE-018 AC3): Public or
  -- FollowersOnly + is_following(viewer, owner).
  IF v_ride.status <> 'open' THEN
    RAISE EXCEPTION 'ride_not_joinable' USING ERRCODE = 'P0001';
  END IF;
  IF v_ride.visibility = 'OnlyMe' THEN
    RAISE EXCEPTION 'ride_not_joinable' USING ERRCODE = 'P0001';
  END IF;
  IF v_ride.visibility = 'FollowersOnly'
     AND NOT public.is_following(v_uid, v_ride.owner_id)
  THEN
    RAISE EXCEPTION 'ride_not_joinable' USING ERRCODE = 'P0001';
  END IF;
  IF v_ride.owner_id = v_uid THEN
    RAISE EXCEPTION 'cannot_join_own_ride' USING ERRCODE = 'P0001';
  END IF;

  -- FR-RIDE-029 AC3 — req_verified_only gate.
  IF v_ride.req_verified_only THEN
    SELECT account_status INTO v_caller_status
      FROM public.users WHERE user_id = v_uid;
    IF v_caller_status IS DISTINCT FROM 'verified' THEN
      RAISE EXCEPTION 'requester_not_verified' USING ERRCODE = 'P0001';
    END IF;
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
