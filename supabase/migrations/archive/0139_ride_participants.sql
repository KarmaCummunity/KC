-- 0139_ride_participants.sql — FR-RIDE-011 ride participants (request / approve / reject / cancel).
--
-- V2.0 of the rides feature used `DirectChatJoinPolicy` per FR-RIDE-010 — i.e.
-- the only "join" was opening a chat. This migration introduces a real
-- participant model so:
--   * Riders can explicitly request a seat with an optional note.
--   * Ride owners can approve/reject requests, with seat-count enforcement
--     at the DB layer (no client-side race on the last seat).
--   * Riders can cancel their own request before or after approval.
--   * The chat thread still works as the negotiation surface — participants
--     are purely the structured "intent of record" alongside it.
--
-- Status machine:
--   requested ──approve──▶ approved ──cancel──▶ cancelled
--             ──reject───▶ rejected
--             ──cancel───▶ cancelled
--   (rejected/cancelled are terminal; re-requesting requires a new row,
--    blocked by the unique-active-participation invariant in the request
--    RPC.)

BEGIN;

CREATE TABLE public.ride_participants (
  participant_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id          uuid NOT NULL REFERENCES public.ride_listings(ride_id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','approved','rejected','cancelled')),
  note             text CHECK (note IS NULL OR char_length(note) <= 500),
  requested_at     timestamptz NOT NULL DEFAULT now(),
  decided_at       timestamptz,
  decided_by       uuid REFERENCES public.users(user_id) ON DELETE SET NULL,
  CONSTRAINT ride_participants_decided_consistency CHECK (
    -- decided_at + decided_by are set together, and only for non-requested states.
    (status = 'requested' AND decided_at IS NULL AND decided_by IS NULL)
    OR (status <> 'requested' AND decided_at IS NOT NULL)
  )
);

-- Unique active participation: a user can have at most one non-terminal row
-- per ride. Terminal rows (rejected/cancelled) can accumulate so we keep an
-- audit trail; the request RPC enforces the live-row constraint.
CREATE UNIQUE INDEX ride_participants_active_unique
  ON public.ride_participants (ride_id, user_id)
  WHERE status IN ('requested','approved');

-- Owner-facing dashboard: "all requests for my ride", grouped by status.
CREATE INDEX ride_participants_ride_status_idx
  ON public.ride_participants (ride_id, status);

-- Rider-facing dashboard: "all rides I'm on / requested", recent first.
CREATE INDEX ride_participants_user_idx
  ON public.ride_participants (user_id, requested_at DESC);

ALTER TABLE public.ride_participants ENABLE ROW LEVEL SECURITY;

-- SELECT: a row is visible to its own user, or to the ride owner.
CREATE POLICY ride_participants_select ON public.ride_participants
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.ride_listings r
      WHERE r.ride_id = public.ride_participants.ride_id
        AND r.owner_id = auth.uid()
    )
  );

-- No direct INSERT/UPDATE/DELETE grants — all mutations go through the
-- SECURITY DEFINER RPCs below so seat-count and state-machine invariants
-- are enforced atomically.
REVOKE INSERT, UPDATE, DELETE ON public.ride_participants FROM authenticated, anon;

-- ---------------------------------------------------------------------------
-- RPC: request to join a ride.
-- ---------------------------------------------------------------------------
-- Validates:
--   * Caller authenticated.
--   * Ride exists, status = 'open', visibility = 'Public'.
--   * Caller is not the ride owner.
--   * No existing active (requested/approved) row for (ride, user).
-- Note (optional, ≤ 500 chars) is stored on the request row.
-- Returns the inserted row.
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
  v_uid     uuid := auth.uid();
  v_ride    public.ride_listings;
  v_row     public.ride_participants;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_ride FROM public.ride_listings WHERE ride_id = p_ride_id;
  IF v_ride.ride_id IS NULL THEN
    RAISE EXCEPTION 'ride_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_ride.status <> 'open' OR v_ride.visibility <> 'Public' THEN
    RAISE EXCEPTION 'ride_not_joinable' USING ERRCODE = 'P0001';
  END IF;
  IF v_ride.owner_id = v_uid THEN
    RAISE EXCEPTION 'cannot_join_own_ride' USING ERRCODE = 'P0001';
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

-- ---------------------------------------------------------------------------
-- RPC: ride owner decides on a request (approve or reject).
-- ---------------------------------------------------------------------------
-- Validates:
--   * Caller authenticated and is the ride owner.
--   * Target row exists, status = 'requested'.
--   * For 'approved': ride is still 'open' AND count(approved) < seats_available.
--     (Ride mode 'request' has seats_available NULL ⇒ no cap; treat as infinite.)
-- Sets decided_at + decided_by.
-- Returns the updated row.
CREATE OR REPLACE FUNCTION public.rpc_ride_participants_decide(
  p_participant_id uuid,
  p_status text
)
RETURNS public.ride_participants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_row       public.ride_participants;
  v_ride      public.ride_listings;
  v_approved  int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_status NOT IN ('approved','rejected') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row FROM public.ride_participants
    WHERE participant_id = p_participant_id
    FOR UPDATE;
  IF v_row.participant_id IS NULL THEN
    RAISE EXCEPTION 'participant_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_row.status <> 'requested' THEN
    RAISE EXCEPTION 'participant_not_pending' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_ride FROM public.ride_listings WHERE ride_id = v_row.ride_id FOR UPDATE;
  IF v_ride.owner_id <> v_uid THEN
    RAISE EXCEPTION 'not_ride_owner' USING ERRCODE = 'P0001';
  END IF;

  IF p_status = 'approved' THEN
    IF v_ride.status <> 'open' THEN
      RAISE EXCEPTION 'ride_not_open' USING ERRCODE = 'P0001';
    END IF;
    -- Seat cap only applies to offers; requests have seats_available NULL.
    IF v_ride.seats_available IS NOT NULL THEN
      SELECT count(*) INTO v_approved
        FROM public.ride_participants
        WHERE ride_id = v_row.ride_id AND status = 'approved';
      IF v_approved >= v_ride.seats_available THEN
        RAISE EXCEPTION 'ride_full' USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  UPDATE public.ride_participants
     SET status      = p_status,
         decided_at  = now(),
         decided_by  = v_uid
   WHERE participant_id = p_participant_id
  RETURNING * INTO v_row;

  RETURN v_row;
END $$;

-- ---------------------------------------------------------------------------
-- RPC: participant cancels their own request/approved seat.
-- ---------------------------------------------------------------------------
-- Validates:
--   * Caller authenticated and is the participant.
--   * Row is in 'requested' or 'approved' status (idempotent on 'cancelled';
--     'rejected' rows are not transitioned).
-- Returns the updated row.
CREATE OR REPLACE FUNCTION public.rpc_ride_participants_cancel(
  p_participant_id uuid
)
RETURNS public.ride_participants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.ride_participants;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_row FROM public.ride_participants
    WHERE participant_id = p_participant_id
    FOR UPDATE;
  IF v_row.participant_id IS NULL THEN
    RAISE EXCEPTION 'participant_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_row.user_id <> v_uid THEN
    RAISE EXCEPTION 'not_participant' USING ERRCODE = 'P0001';
  END IF;
  IF v_row.status = 'cancelled' THEN
    RETURN v_row;
  END IF;
  IF v_row.status = 'rejected' THEN
    RAISE EXCEPTION 'cannot_cancel_rejected' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.ride_participants
     SET status     = 'cancelled',
         decided_at = now(),
         decided_by = v_uid
   WHERE participant_id = p_participant_id
  RETURNING * INTO v_row;

  RETURN v_row;
END $$;

GRANT EXECUTE ON FUNCTION public.rpc_ride_participants_request(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_ride_participants_decide(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_ride_participants_cancel(uuid) TO authenticated;

COMMIT;
