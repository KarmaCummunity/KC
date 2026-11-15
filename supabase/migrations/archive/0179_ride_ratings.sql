-- 0179_ride_ratings.sql — FR-RIDE-037..039 ride ratings system.
--
-- After a ride enters `completed_pending_rating` (FR-RIDE-031), owner + each
-- snapshot participant gets 7 days to rate the COUNTERPART (owner-rates-rider
-- or rider-rates-owner — riders do not rate each other in V3.0).
--
-- Forced 1-star penalty ratings (FR-RIDE-039) carry is_penalty=true so the
-- aggregation view can flag them (currently still counted as 1-star to keep
-- the rating signal honest).

BEGIN;

CREATE TABLE public.ride_ratings (
  rating_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id      uuid NOT NULL REFERENCES public.ride_listings(ride_id) ON DELETE CASCADE,
  rater_id     uuid NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
  ratee_id     uuid NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
  stars        int  NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment      text NULL CHECK (comment IS NULL OR char_length(comment) <= 300),
  is_penalty   boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- One rating per (ride, rater, ratee).
  UNIQUE (ride_id, rater_id, ratee_id),
  -- Defensive: cannot rate yourself.
  CONSTRAINT ride_ratings_no_self_rating CHECK (rater_id <> ratee_id)
);

CREATE INDEX ride_ratings_ratee_idx ON public.ride_ratings (ratee_id, created_at DESC);
CREATE INDEX ride_ratings_ride_idx ON public.ride_ratings (ride_id);

ALTER TABLE public.ride_ratings ENABLE ROW LEVEL SECURITY;

-- SELECT: rater sees their own; ratee sees ratings about them; super-admin all.
CREATE POLICY ride_ratings_select ON public.ride_ratings
  FOR SELECT TO authenticated
  USING (
    rater_id = auth.uid()
    OR ratee_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.users u
       WHERE u.user_id = auth.uid() AND u.is_super_admin = true
    )
  );

REVOKE INSERT, UPDATE, DELETE ON public.ride_ratings FROM authenticated, anon;

-- ---------------------------------------------------------------------------
-- RPC — submit a rating.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_ride_rate(
  p_ride_id    uuid,
  p_ratee_id   uuid,
  p_stars      int,
  p_comment    text    DEFAULT NULL,
  p_is_penalty boolean DEFAULT false
)
RETURNS public.ride_ratings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_ride         public.ride_listings;
  v_is_owner     boolean;
  v_is_snapshot  boolean;
  v_ratee_owner  boolean;
  v_ratee_snap   boolean;
  v_row          public.ride_ratings;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_stars IS NULL OR p_stars < 1 OR p_stars > 5 THEN
    RAISE EXCEPTION 'rating_invalid_stars' USING ERRCODE = '22023';
  END IF;
  IF p_ratee_id = v_uid THEN
    RAISE EXCEPTION 'rating_self_rating' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_ride FROM public.ride_listings WHERE ride_id = p_ride_id;
  IF v_ride.ride_id IS NULL THEN
    RAISE EXCEPTION 'ride_not_found' USING ERRCODE = 'P0001';
  END IF;
  -- Ratings only land while the row is still in completed_pending_rating
  -- (7-day window per FR-RIDE-037 AC5). After cron flips to `closed` the
  -- window has closed — though the closure happens 7 days post-arrival so
  -- this is belt-and-suspenders.
  IF v_ride.status <> 'completed_pending_rating' THEN
    RAISE EXCEPTION 'rating_window_closed' USING ERRCODE = 'P0001';
  END IF;
  IF v_ride.arrived_at IS NULL OR v_ride.arrived_at + interval '7 days' < now() THEN
    RAISE EXCEPTION 'rating_window_closed' USING ERRCODE = 'P0001';
  END IF;

  -- Caller must be owner or snapshot participant; ratee must be the
  -- counterpart (owner ↔ snapshot rider only — riders don't rate each other).
  v_is_owner := (v_ride.owner_id = v_uid);
  v_is_snapshot := v_is_owner OR EXISTS (
    SELECT 1 FROM public.ride_participants
     WHERE ride_id = p_ride_id
       AND user_id = v_uid
       AND joined_active_at IS NOT NULL
  );
  IF NOT v_is_snapshot THEN
    RAISE EXCEPTION 'rating_not_participant' USING ERRCODE = 'P0001';
  END IF;

  v_ratee_owner := (v_ride.owner_id = p_ratee_id);
  v_ratee_snap := v_ratee_owner OR EXISTS (
    SELECT 1 FROM public.ride_participants
     WHERE ride_id = p_ride_id
       AND user_id = p_ratee_id
       AND joined_active_at IS NOT NULL
  );
  IF NOT v_ratee_snap THEN
    RAISE EXCEPTION 'rating_not_participant' USING ERRCODE = 'P0001';
  END IF;

  -- Owner rates rider XOR rider rates owner — rider-to-rider rejected.
  IF (v_is_owner AND v_ratee_owner) OR (NOT v_is_owner AND NOT v_ratee_owner) THEN
    RAISE EXCEPTION 'rating_not_participant' USING ERRCODE = 'P0001';
  END IF;

  -- Unique-per-(ride, rater, ratee) — upsert? No, FR-RIDE-037 AC3 has UNIQUE
  -- + no editing in V3.0; second submission errors.
  INSERT INTO public.ride_ratings (ride_id, rater_id, ratee_id, stars, comment, is_penalty)
  VALUES (p_ride_id, v_uid, p_ratee_id, p_stars, p_comment, coalesce(p_is_penalty, false))
  RETURNING * INTO v_row;

  RETURN v_row;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'rating_duplicate' USING ERRCODE = 'P0001';
END $$;

GRANT EXECUTE ON FUNCTION public.rpc_ride_rate(uuid, uuid, int, text, boolean) TO authenticated;

-- ---------------------------------------------------------------------------
-- View — per-ratee aggregate (FR-RIDE-038).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.user_ride_rating_summary
  WITH (security_invoker = true)
AS
SELECT
  ratee_id                      AS user_id,
  count(*)                      AS ratings_count,
  round(avg(stars)::numeric, 1) AS avg_stars,
  max(created_at)               AS last_rated_at
FROM public.ride_ratings
GROUP BY ratee_id;

COMMENT ON VIEW public.user_ride_rating_summary IS
  'FR-RIDE-038 — per-user ride rating aggregate. security_invoker=true so RLS on ride_ratings still applies (rater sees own, ratee sees about-them, super-admin all).';

GRANT SELECT ON public.user_ride_rating_summary TO authenticated;

-- ---------------------------------------------------------------------------
-- ride_rate_prompt notification — fires when a ride enters
-- completed_pending_rating; one push per snapshot member (rider + owner).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ride_rate_prompt_fanout()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_p record;
BEGIN
  -- Notify the owner first.
  PERFORM public.enqueue_notification(
    NEW.owner_id,
    'social',
    'ride_rate_prompt',
    'notifications.rideRatePromptTitle',
    'notifications.rideRatePromptBody',
    jsonb_build_object('rideTitle', NEW.title),
    jsonb_build_object(
      'route',  '/(tabs)/donations/rides/[id]',
      'params', jsonb_build_object('id', NEW.ride_id::text)
    ),
    'ride_rate_prompt:' || NEW.ride_id::text || ':owner',
    false
  );

  -- Then every snapshot participant.
  FOR v_p IN
    SELECT user_id FROM public.ride_participants
     WHERE ride_id = NEW.ride_id
       AND joined_active_at IS NOT NULL
  LOOP
    PERFORM public.enqueue_notification(
      v_p.user_id,
      'social',
      'ride_rate_prompt',
      'notifications.rideRatePromptTitle',
      'notifications.rideRatePromptBody',
      jsonb_build_object('rideTitle', NEW.title),
      jsonb_build_object(
        'route',  '/(tabs)/donations/rides/[id]',
        'params', jsonb_build_object('id', NEW.ride_id::text)
      ),
      'ride_rate_prompt:' || NEW.ride_id::text || ':rider:' || v_p.user_id::text,
      false
    );
  END LOOP;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_ride_rate_prompt_fanout ON public.ride_listings;
CREATE TRIGGER tg_ride_rate_prompt_fanout
  AFTER UPDATE OF status ON public.ride_listings
  FOR EACH ROW
  WHEN (OLD.status = 'in_transit' AND NEW.status = 'completed_pending_rating')
  EXECUTE FUNCTION public.ride_rate_prompt_fanout();

COMMIT;
