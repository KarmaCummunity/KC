-- 0177_ride_active_lifecycle.sql — FR-RIDE-031..033 active ride lifecycle.
--
-- Extends the ride_listings.status FSM with two transient states between
-- `open` and the terminal `closed`/`cancelled`/`expired`:
--
--   open
--    ├── (owner taps "Start" ≤ 30 min before departs_at) ──▶ in_transit
--    │                                                         ├── (owner taps "Arrive") ──▶ completed_pending_rating
--    │                                                         │                                  └── (cron after 7d) ──▶ closed
--    │                                                         └── (owner taps "Arrive" w/ p_reason='breakdown') ──▶ completed_pending_rating
--    ├── (owner taps "Close") ──▶ closed
--    ├── (owner taps "Cancel") ──▶ cancelled
--    └── (cron at departs_at + 3h) ──▶ expired   (existing 0135)
--
-- The `started_at` + `arrived_at` columns capture the actual transitions for
-- ratings + insurance forensics. `joined_active_at` on ride_participants
-- freezes the snapshot of who actually rode (FR-RIDE-032 AC2) — once the ride
-- starts, late `requested → approved` is no longer permitted (the existing
-- decide RPC already rejects approve when ride is not 'open').

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Extend the status enum CHECK.
-- ---------------------------------------------------------------------------
ALTER TABLE public.ride_listings
  DROP CONSTRAINT IF EXISTS ride_listings_status_check;

ALTER TABLE public.ride_listings
  ADD CONSTRAINT ride_listings_status_check CHECK (
    status IN ('open','in_transit','completed_pending_rating','closed','cancelled','expired')
  );

-- ---------------------------------------------------------------------------
-- 2. Timestamps for the new transitions.
-- ---------------------------------------------------------------------------
ALTER TABLE public.ride_listings
  ADD COLUMN started_at timestamptz NULL,
  ADD COLUMN arrived_at timestamptz NULL;

-- Forward-compat for early-arrive with a reason (e.g. breakdown — FR-RIDE-045 AC4).
ALTER TABLE public.ride_listings
  ADD COLUMN arrive_reason text NULL
    CHECK (arrive_reason IS NULL OR arrive_reason IN ('arrived','breakdown'));

-- ---------------------------------------------------------------------------
-- 3. Snapshot column on participants (FR-RIDE-032).
-- ---------------------------------------------------------------------------
ALTER TABLE public.ride_participants
  ADD COLUMN joined_active_at timestamptz NULL;

CREATE INDEX ride_participants_joined_active_idx
  ON public.ride_participants (ride_id)
  WHERE joined_active_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. rpc_ride_start — owner check-in.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_ride_start(p_ride_id uuid)
RETURNS public.ride_listings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_ride public.ride_listings;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_ride FROM public.ride_listings WHERE ride_id = p_ride_id FOR UPDATE;
  IF v_ride.ride_id IS NULL THEN
    RAISE EXCEPTION 'ride_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_ride.owner_id <> v_uid THEN
    RAISE EXCEPTION 'not_ride_owner' USING ERRCODE = 'P0001';
  END IF;

  -- Idempotent on already-started.
  IF v_ride.status = 'in_transit' THEN
    RETURN v_ride;
  END IF;
  IF v_ride.status <> 'open' THEN
    RAISE EXCEPTION 'invalid_status_transition' USING ERRCODE = 'P0001';
  END IF;
  -- Owner can start from 30 minutes before scheduled departure onward
  -- (FR-RIDE-033 AC1).
  IF v_ride.departs_at - interval '30 minutes' > now() THEN
    RAISE EXCEPTION 'start_window_not_open' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.ride_listings
     SET status = 'in_transit',
         started_at = now()
   WHERE ride_id = p_ride_id
  RETURNING * INTO v_ride;

  -- Snapshot approved riders (FR-RIDE-032 AC2).
  UPDATE public.ride_participants
     SET joined_active_at = v_ride.started_at
   WHERE ride_id = p_ride_id
     AND status = 'approved'
     AND joined_active_at IS NULL;

  RETURN v_ride;
END $$;

-- ---------------------------------------------------------------------------
-- 5. rpc_ride_arrive — owner marks arrival.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_ride_arrive(
  p_ride_id uuid,
  p_reason  text DEFAULT 'arrived'
)
RETURNS public.ride_listings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_ride public.ride_listings;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_reason NOT IN ('arrived','breakdown') THEN
    RAISE EXCEPTION 'invalid_status_transition' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_ride FROM public.ride_listings WHERE ride_id = p_ride_id FOR UPDATE;
  IF v_ride.ride_id IS NULL THEN
    RAISE EXCEPTION 'ride_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_ride.owner_id <> v_uid THEN
    RAISE EXCEPTION 'not_ride_owner' USING ERRCODE = 'P0001';
  END IF;

  IF v_ride.status = 'completed_pending_rating' THEN
    RETURN v_ride;
  END IF;
  IF v_ride.status <> 'in_transit' THEN
    RAISE EXCEPTION 'ride_not_in_transit' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.ride_listings
     SET status        = 'completed_pending_rating',
         arrived_at    = now(),
         arrive_reason = p_reason
   WHERE ride_id = p_ride_id
  RETURNING * INTO v_ride;

  RETURN v_ride;
END $$;

-- ---------------------------------------------------------------------------
-- 6. Cron: auto-close `completed_pending_rating` rides 7 days after arrival.
-- ---------------------------------------------------------------------------
-- The ratings window closes (FR-RIDE-031 AC4 + FR-RIDE-037 AC5); the row
-- freezes for analytics.
CREATE OR REPLACE FUNCTION public.ride_complete_pending_rating_cleanup()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.ride_listings
     SET status = 'closed'
   WHERE status = 'completed_pending_rating'
     AND arrived_at IS NOT NULL
     AND arrived_at + interval '7 days' < now();
END $$;

SELECT cron.schedule(
  'ride_complete_pending_rating_cleanup_daily',
  '15 3 * * *',
  $$ SELECT public.ride_complete_pending_rating_cleanup(); $$
);

-- ---------------------------------------------------------------------------
-- 7. Chat system messages for the two new transitions (extends FR-RIDE-015).
-- ---------------------------------------------------------------------------
-- The existing `ride_listings_clear_chat_anchor` trigger (from 0137 + 0142)
-- emits a chat system message + clears the anchor when the ride leaves `open`.
-- The new transitions (open → in_transit, in_transit → completed_pending_rating)
-- do NOT clear the anchor (the chat thread is still useful while the ride is
-- active), but they SHOULD emit a system message so participants see the
-- transition without polling.
CREATE OR REPLACE FUNCTION public.ride_listings_active_transition_notify_chats()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_chat record;
  v_kind text;
  v_body text;
  v_payload jsonb;
BEGIN
  -- Pick the message kind + body based on the transition.
  IF OLD.status = 'open' AND NEW.status = 'in_transit' THEN
    v_kind := 'ride_started';
    v_body := 'הנסיעה החלה';
  ELSIF OLD.status = 'in_transit' AND NEW.status = 'completed_pending_rating' THEN
    IF NEW.arrive_reason = 'breakdown' THEN
      v_kind := 'ride_breakdown';
      v_body := 'הנסיעה הסתיימה בעקבות תקלה ברכב';
    ELSE
      v_kind := 'ride_arrived';
      v_body := 'הנסיעה הסתיימה';
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  v_payload := jsonb_build_object(
    'kind',    v_kind,
    'ride_id', NEW.ride_id::text,
    'status',  NEW.status
  );

  -- Insert a system_message into every chat anchored to this ride; mirrors
  -- the existing pattern in 0142_ride_chat_system_messages.sql (we cannot
  -- call inject_system_message because EXECUTE is revoked from clients,
  -- and a trigger context cannot impersonate; this DEFINER runs as the
  -- table owner which has direct INSERT rights).
  FOR v_chat IN
    SELECT chat_id FROM public.chats WHERE anchor_ride_id = NEW.ride_id
  LOOP
    INSERT INTO public.messages (
      chat_id, sender_id, kind, body, system_payload, status, delivered_at
    ) VALUES (
      v_chat.chat_id, NULL, 'system', v_body, v_payload, 'delivered', now()
    );
  END LOOP;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_ride_listings_active_transition_chats ON public.ride_listings;
CREATE TRIGGER tg_ride_listings_active_transition_chats
  AFTER UPDATE OF status ON public.ride_listings
  FOR EACH ROW
  WHEN (
    (OLD.status = 'open'       AND NEW.status = 'in_transit')
    OR (OLD.status = 'in_transit' AND NEW.status = 'completed_pending_rating')
  )
  EXECUTE FUNCTION public.ride_listings_active_transition_notify_chats();

-- ---------------------------------------------------------------------------
-- 8. Notify snapshot participants of the transitions.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ride_active_transition_notify_participants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_participant record;
  v_kind        text;
  v_critical    boolean;
  v_title_key   text;
  v_body_key    text;
BEGIN
  IF OLD.status = 'open' AND NEW.status = 'in_transit' THEN
    v_kind      := 'ride_started';
    v_critical  := true;
    v_title_key := 'notifications.rideStartedTitle';
    v_body_key  := 'notifications.rideStartedBody';
  ELSIF OLD.status = 'in_transit' AND NEW.status = 'completed_pending_rating' THEN
    IF NEW.arrive_reason = 'breakdown' THEN
      v_kind      := 'ride_breakdown';
      v_critical  := true;
      v_title_key := 'notifications.rideBreakdownTitle';
      v_body_key  := 'notifications.rideBreakdownBody';
    ELSE
      v_kind      := 'ride_arrived';
      v_critical  := false;
      v_title_key := 'notifications.rideArrivedTitle';
      v_body_key  := 'notifications.rideArrivedBody';
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  FOR v_participant IN
    SELECT user_id
      FROM public.ride_participants
     WHERE ride_id = NEW.ride_id
       AND joined_active_at IS NOT NULL
  LOOP
    PERFORM public.enqueue_notification(
      v_participant.user_id,
      CASE WHEN v_critical THEN 'critical'::text ELSE 'social'::text END,
      v_kind,
      v_title_key,
      v_body_key,
      jsonb_build_object('rideTitle', NEW.title),
      jsonb_build_object(
        'route',  '/donations/rides/[id]',
        'params', jsonb_build_object('id', NEW.ride_id::text)
      ),
      v_kind || ':' || NEW.ride_id::text,
      false
    );
  END LOOP;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_ride_active_transition_notify_participants ON public.ride_listings;
CREATE TRIGGER tg_ride_active_transition_notify_participants
  AFTER UPDATE OF status ON public.ride_listings
  FOR EACH ROW
  WHEN (
    (OLD.status = 'open'       AND NEW.status = 'in_transit')
    OR (OLD.status = 'in_transit' AND NEW.status = 'completed_pending_rating')
  )
  EXECUTE FUNCTION public.ride_active_transition_notify_participants();

-- ---------------------------------------------------------------------------
-- 9. Grants.
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.rpc_ride_start(uuid)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_ride_arrive(uuid, text)     TO authenticated;

COMMIT;
