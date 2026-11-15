-- 0174_ride_participants_cascade_cancel.sql — FR-RIDE-019.
--
-- When a ride leaves `open` (owner closes / cancels / cron expires), every
-- still-`approved` participant row must transition to `cancelled` in the same
-- transaction so that:
--   * The participant's "my requests" surface reflects the lost seat.
--   * Seat-count reads return the correct value.
--   * The decision-notification trigger fires the variant
--     `ride_participant_cancelled_by_owner` (targeted at the rider) instead of
--     the rider-initiated `ride_participant_cancelled` (targeted at the owner).
--
-- The `requested` rows are handled separately by the existing 0151 cron
-- (`ride_participants_expire_stale_check`) — silent, since polite withdrawals
-- of pending requests don't warrant a ping.

BEGIN;

-- ---------------------------------------------------------------------------
-- Step 1 — Replace the decision-notification trigger to branch on the
--          system marker (decided_by IS NULL) for the approved→cancelled path.
-- ---------------------------------------------------------------------------
-- For approved→cancelled with decided_by = rider's own user_id (rider quit):
--   → notify the OWNER with `ride_participant_cancelled` (unchanged behavior).
-- For approved→cancelled with decided_by IS NULL AND parent ride in terminal
-- state (closed/cancelled/expired) (system cascade):
--   → notify the PARTICIPANT with `ride_participant_cancelled_by_owner`.
-- All other approved→cancelled cases (defensive: decided_by set to someone
-- other than the rider or the owner — should not happen via RPCs) fall through
-- to the rider-initiated path so we never lose a ping.

CREATE OR REPLACE FUNCTION public.ride_participants_enqueue_decision_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ride            record;
  v_owner_name      text;
  v_rider_name      text;
  v_is_system_owner boolean;
BEGIN
  SELECT owner_id, title, status INTO v_ride
    FROM public.ride_listings
   WHERE ride_id = NEW.ride_id;
  IF v_ride.owner_id IS NULL THEN RETURN NEW; END IF;

  -- requested → approved : notify rider
  IF OLD.status = 'requested' AND NEW.status = 'approved' THEN
    SELECT coalesce(display_name, 'Karma user') INTO v_owner_name
      FROM public.users WHERE user_id = v_ride.owner_id;
    v_owner_name := coalesce(v_owner_name, 'Karma user');

    PERFORM public.enqueue_notification(
      NEW.user_id,
      'critical',
      'ride_approved',
      'notifications.rideApprovedTitle',
      'notifications.rideApprovedBody',
      jsonb_build_object('ownerName', v_owner_name, 'rideTitle', v_ride.title),
      jsonb_build_object(
        'route',  '/donations/rides/[id]',
        'params', jsonb_build_object('id', NEW.ride_id::text),
        'participant_id', NEW.participant_id::text
      ),
      'ride_decision:' || NEW.participant_id::text || ':approved',
      false
    );

  -- requested → rejected : notify rider
  ELSIF OLD.status = 'requested' AND NEW.status = 'rejected' THEN
    SELECT coalesce(display_name, 'Karma user') INTO v_owner_name
      FROM public.users WHERE user_id = v_ride.owner_id;
    v_owner_name := coalesce(v_owner_name, 'Karma user');

    PERFORM public.enqueue_notification(
      NEW.user_id,
      'critical',
      'ride_rejected',
      'notifications.rideRejectedTitle',
      'notifications.rideRejectedBody',
      jsonb_build_object('ownerName', v_owner_name, 'rideTitle', v_ride.title),
      jsonb_build_object(
        'route',  '/donations/rides/[id]',
        'params', jsonb_build_object('id', NEW.ride_id::text),
        'participant_id', NEW.participant_id::text
      ),
      'ride_decision:' || NEW.participant_id::text || ':rejected',
      false
    );

  -- approved → cancelled : branch on system marker (FR-RIDE-019 AC3).
  ELSIF OLD.status = 'approved' AND NEW.status = 'cancelled' THEN
    -- The owner-driven cascade marks rows with decided_by = NULL AND the
    -- parent ride is already non-open by the time the trigger fires (we
    -- update participants in the same transaction *after* the listing UPDATE).
    v_is_system_owner := (
      NEW.decided_by IS NULL
      AND v_ride.status IN ('closed','cancelled','expired')
    );

    IF v_is_system_owner THEN
      -- Notify the participant that their seat was cancelled by the cascade.
      SELECT coalesce(display_name, 'Karma user') INTO v_owner_name
        FROM public.users WHERE user_id = v_ride.owner_id;
      v_owner_name := coalesce(v_owner_name, 'Karma user');

      PERFORM public.enqueue_notification(
        NEW.user_id,
        'critical',
        'ride_participant_cancelled_by_owner',
        'notifications.rideCancelledByOwnerTitle',
        'notifications.rideCancelledByOwnerBody',
        jsonb_build_object('ownerName', v_owner_name, 'rideTitle', v_ride.title),
        jsonb_build_object(
          'route',  '/donations/rides/[id]',
          'params', jsonb_build_object('id', NEW.ride_id::text),
          'participant_id', NEW.participant_id::text
        ),
        'ride_cancelled_by_owner:' || NEW.participant_id::text,
        false
      );
    ELSE
      -- Rider-initiated withdrawal: notify owner.
      SELECT coalesce(display_name, 'Karma user') INTO v_rider_name
        FROM public.users WHERE user_id = NEW.user_id;
      v_rider_name := coalesce(v_rider_name, 'Karma user');

      PERFORM public.enqueue_notification(
        v_ride.owner_id,
        'critical',
        'ride_participant_cancelled',
        'notifications.rideParticipantCancelledTitle',
        'notifications.rideParticipantCancelledBody',
        jsonb_build_object('riderName', v_rider_name, 'rideTitle', v_ride.title),
        jsonb_build_object(
          'route',  '/donations/rides/[id]',
          'params', jsonb_build_object('id', NEW.ride_id::text),
          'participant_id', NEW.participant_id::text
        ),
        'ride_participant_cancelled:' || NEW.participant_id::text,
        false
      );
    END IF;
  END IF;

  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------
-- Step 2 — Trigger on ride_listings AFTER UPDATE: when status leaves `open`,
--          cascade-cancel every still-approved participant row.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ride_listings_cascade_cancel_approved()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Only act when the listing actually left the `open` state into a terminal one.
  IF OLD.status = 'open'
     AND NEW.status IN ('closed','cancelled','expired')
  THEN
    UPDATE public.ride_participants
       SET status     = 'cancelled',
           decided_at = now(),
           decided_by = NULL   -- system marker (FR-RIDE-019 AC2)
     WHERE ride_id = NEW.ride_id
       AND status  = 'approved';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_ride_listings_cascade_cancel_approved ON public.ride_listings;
CREATE TRIGGER tg_ride_listings_cascade_cancel_approved
  AFTER UPDATE OF status ON public.ride_listings
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.ride_listings_cascade_cancel_approved();

COMMIT;
