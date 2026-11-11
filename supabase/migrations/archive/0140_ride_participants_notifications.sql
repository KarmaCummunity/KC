-- 0140_ride_participants_notifications.sql — FR-RIDE-013 push for participant lifecycle.
--
-- Now that ride_participants exists (0139) and the application-layer use cases
-- are wired (FR-RIDE-012), every lifecycle event in the participant flow
-- should produce a push notification — same outbox pattern as posts:
--
--   * On INSERT (status = 'requested')           → owner gets ride_request
--   * On UPDATE status: requested → approved     → rider gets ride_approved
--   * On UPDATE status: requested → rejected     → rider gets ride_rejected
--   * On UPDATE status: approved  → cancelled    → owner gets ride_participant_cancelled
--                       (rider-initiated; "requested → cancelled" is the polite
--                        withdrawal and isn't worth a ping.)
--
-- Self-suppression is handled inside enqueue_notification via auth.uid().

BEGIN;

CREATE OR REPLACE FUNCTION public.ride_participants_enqueue_request_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ride       record;
  v_rider_name text;
BEGIN
  SELECT owner_id, title INTO v_ride
    FROM public.ride_listings
   WHERE ride_id = NEW.ride_id;
  IF v_ride.owner_id IS NULL THEN RETURN NEW; END IF;

  SELECT coalesce(display_name, 'Karma user') INTO v_rider_name
    FROM public.users WHERE user_id = NEW.user_id;
  v_rider_name := coalesce(v_rider_name, 'Karma user');

  PERFORM public.enqueue_notification(
    v_ride.owner_id,
    'critical',
    'ride_request',
    'notifications.rideRequestTitle',
    'notifications.rideRequestBody',
    jsonb_build_object('riderName', v_rider_name, 'rideTitle', v_ride.title),
    jsonb_build_object(
      'route',  '/donations/rides/[id]',
      'params', jsonb_build_object('id', NEW.ride_id::text),
      'participant_id', NEW.participant_id::text
    ),
    'ride_request:' || NEW.participant_id::text,
    false
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_ride_participants_enqueue_request_notification ON public.ride_participants;
CREATE TRIGGER tg_ride_participants_enqueue_request_notification
  AFTER INSERT ON public.ride_participants
  FOR EACH ROW
  WHEN (NEW.status = 'requested')
  EXECUTE FUNCTION public.ride_participants_enqueue_request_notification();

CREATE OR REPLACE FUNCTION public.ride_participants_enqueue_decision_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ride        record;
  v_owner_name  text;
  v_rider_name  text;
BEGIN
  SELECT owner_id, title INTO v_ride
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

  -- approved → cancelled : participant withdrew an approved seat; notify owner
  ELSIF OLD.status = 'approved' AND NEW.status = 'cancelled' THEN
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

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_ride_participants_enqueue_decision_notification ON public.ride_participants;
CREATE TRIGGER tg_ride_participants_enqueue_decision_notification
  AFTER UPDATE OF status ON public.ride_participants
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.ride_participants_enqueue_decision_notification();

COMMIT;
