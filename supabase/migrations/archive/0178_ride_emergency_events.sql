-- 0178_ride_emergency_events.sql — FR-RIDE-035 emergency button.
--
-- During an active ride (`status='in_transit'`), the owner or any snapshot
-- participant may trigger an emergency event. This:
--   * Inserts a row into `ride_emergency_events` with optional lat/lng + note.
--   * Notifies all super-admins + every other snapshot participant (critical
--     push).
--   * Posts a system message into the triggering user's super-admin support
--     thread so the admin sees it inline with chat ops.
--   * Is rate-limited to 1 trigger per (user, ride) per 5 minutes.
-- The event is "open" until a super-admin marks it resolved (separate admin
-- RPC, deferred to admin portal A5+).

BEGIN;

CREATE TABLE public.ride_emergency_events (
  event_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id       uuid NOT NULL REFERENCES public.ride_listings(ride_id) ON DELETE CASCADE,
  triggered_by  uuid NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
  triggered_at  timestamptz NOT NULL DEFAULT now(),
  lat           double precision NULL CHECK (lat IS NULL OR (lat BETWEEN -90  AND 90)),
  lng           double precision NULL CHECK (lng IS NULL OR (lng BETWEEN -180 AND 180)),
  note          text NULL CHECK (note IS NULL OR char_length(note) <= 500),
  resolved_at   timestamptz NULL,
  resolved_by   uuid NULL REFERENCES public.users(user_id) ON DELETE SET NULL
);

CREATE INDEX ride_emergency_events_ride_idx
  ON public.ride_emergency_events (ride_id, triggered_at DESC);

CREATE INDEX ride_emergency_events_open_idx
  ON public.ride_emergency_events (triggered_at DESC)
  WHERE resolved_at IS NULL;

ALTER TABLE public.ride_emergency_events ENABLE ROW LEVEL SECURITY;

-- SELECT: triggering user, ride owner, super-admin (FR-RIDE-035 AC8).
CREATE POLICY ride_emergency_events_select ON public.ride_emergency_events
  FOR SELECT TO authenticated
  USING (
    triggered_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.ride_listings r
       WHERE r.ride_id = public.ride_emergency_events.ride_id
         AND r.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.users u
       WHERE u.user_id = auth.uid()
         AND u.is_super_admin = true
    )
  );

-- No direct INSERT/UPDATE — all through the RPCs below.
REVOKE INSERT, UPDATE, DELETE ON public.ride_emergency_events FROM authenticated, anon;

-- ---------------------------------------------------------------------------
-- RPC — trigger an emergency.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_ride_emergency_trigger(
  p_ride_id uuid,
  p_lat     double precision DEFAULT NULL,
  p_lng     double precision DEFAULT NULL,
  p_note    text             DEFAULT NULL
)
RETURNS public.ride_emergency_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid             uuid := auth.uid();
  v_ride            public.ride_listings;
  v_is_snapshot     boolean;
  v_recent          int;
  v_row             public.ride_emergency_events;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_ride FROM public.ride_listings WHERE ride_id = p_ride_id;
  IF v_ride.ride_id IS NULL THEN
    RAISE EXCEPTION 'ride_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_ride.status <> 'in_transit' THEN
    RAISE EXCEPTION 'ride_not_in_transit' USING ERRCODE = 'P0001';
  END IF;

  -- Snapshot membership: owner OR a participant with joined_active_at IS NOT NULL.
  v_is_snapshot := (v_ride.owner_id = v_uid)
    OR EXISTS (
      SELECT 1 FROM public.ride_participants
       WHERE ride_id = p_ride_id
         AND user_id = v_uid
         AND joined_active_at IS NOT NULL
    );
  IF NOT v_is_snapshot THEN
    RAISE EXCEPTION 'not_ride_participant' USING ERRCODE = 'P0001';
  END IF;

  -- Rate limit: 1 trigger per user per ride per 5 minutes.
  SELECT count(*) INTO v_recent
    FROM public.ride_emergency_events
   WHERE ride_id = p_ride_id
     AND triggered_by = v_uid
     AND triggered_at > now() - interval '5 minutes';
  IF v_recent > 0 THEN
    RAISE EXCEPTION 'emergency_throttled' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.ride_emergency_events (
    ride_id, triggered_by, lat, lng, note
  ) VALUES (
    p_ride_id, v_uid, p_lat, p_lng, p_note
  ) RETURNING * INTO v_row;

  RETURN v_row;
END $$;

GRANT EXECUTE ON FUNCTION public.rpc_ride_emergency_trigger(uuid, double precision, double precision, text)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- Trigger — fan out notifications + chat message on insert.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ride_emergency_events_fanout()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin       record;
  v_participant record;
  v_ride        record;
  v_chat_id     uuid;
  v_payload     jsonb;
  v_body        text;
BEGIN
  SELECT title, owner_id INTO v_ride
    FROM public.ride_listings WHERE ride_id = NEW.ride_id;

  v_payload := jsonb_build_object(
    'kind',       'ride_emergency',
    'ride_id',    NEW.ride_id::text,
    'event_id',   NEW.event_id::text,
    'has_coords', (NEW.lat IS NOT NULL AND NEW.lng IS NOT NULL)
  );

  -- 1) Push to every super-admin (critical).
  FOR v_admin IN
    SELECT user_id FROM public.users WHERE is_super_admin = true
  LOOP
    PERFORM public.enqueue_notification(
      v_admin.user_id,
      'critical',
      'ride_emergency',
      'notifications.rideEmergencyTitle',
      'notifications.rideEmergencyBody',
      jsonb_build_object('rideTitle', v_ride.title),
      jsonb_build_object(
        'route',  '/(tabs)/donations/rides/[id]',
        'params', jsonb_build_object('id', NEW.ride_id::text)
      ),
      'ride_emergency:' || NEW.event_id::text || ':admin:' || v_admin.user_id::text,
      false
    );
  END LOOP;

  -- 2) Push to every OTHER snapshot participant (critical).
  -- "Other" = exclude the triggering user; include the owner if they didn't trigger.
  IF v_ride.owner_id <> NEW.triggered_by THEN
    PERFORM public.enqueue_notification(
      v_ride.owner_id,
      'critical',
      'ride_emergency',
      'notifications.rideEmergencyTitle',
      'notifications.rideEmergencyBody',
      jsonb_build_object('rideTitle', v_ride.title),
      jsonb_build_object(
        'route',  '/(tabs)/donations/rides/[id]',
        'params', jsonb_build_object('id', NEW.ride_id::text)
      ),
      'ride_emergency:' || NEW.event_id::text || ':owner',
      false
    );
  END IF;

  FOR v_participant IN
    SELECT user_id FROM public.ride_participants
     WHERE ride_id = NEW.ride_id
       AND joined_active_at IS NOT NULL
       AND user_id <> NEW.triggered_by
  LOOP
    PERFORM public.enqueue_notification(
      v_participant.user_id,
      'critical',
      'ride_emergency',
      'notifications.rideEmergencyTitle',
      'notifications.rideEmergencyBody',
      jsonb_build_object('rideTitle', v_ride.title),
      jsonb_build_object(
        'route',  '/(tabs)/donations/rides/[id]',
        'params', jsonb_build_object('id', NEW.ride_id::text)
      ),
      'ride_emergency:' || NEW.event_id::text || ':rider:' || v_participant.user_id::text,
      false
    );
  END LOOP;

  -- 3) Post a system message into the triggering user's super-admin support
  --    thread so the admin gets the inline alert. The support thread is the
  --    direct chat between the triggering user and any super_admin (the
  --    `rpc_get_or_create_support_chat` flow lives elsewhere; we look up the
  --    existing thread for the triggering user when one exists).
  --
  --    The thread is identified by chats.is_support_thread (see FR-CHAT-007).
  --    If multiple support threads exist for a given user (shouldn't, but
  --    defensive) we pick the most recent.
  SELECT chat_id INTO v_chat_id
    FROM public.chats
   WHERE is_support_thread = true
     AND (
       participant_a = NEW.triggered_by
       OR participant_b = NEW.triggered_by
     )
   ORDER BY last_message_at DESC NULLS LAST
   LIMIT 1;

  IF v_chat_id IS NOT NULL THEN
    v_body := 'הופעלה התראת חירום בנסיעה';
    INSERT INTO public.messages (
      chat_id, sender_id, kind, body, system_payload, status, delivered_at
    ) VALUES (
      v_chat_id, NULL, 'system', v_body, v_payload, 'delivered', now()
    );
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_ride_emergency_events_fanout ON public.ride_emergency_events;
CREATE TRIGGER tg_ride_emergency_events_fanout
  AFTER INSERT ON public.ride_emergency_events
  FOR EACH ROW
  EXECUTE FUNCTION public.ride_emergency_events_fanout();

COMMIT;
