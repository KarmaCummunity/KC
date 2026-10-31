-- 0466_rating_given_karma | KC#1306 — spec 07 §7.6 awards 2 karma for "Rating given".
--
-- Ratings stored nothing on the karma side. Each handoff rating (`rate_giving_handoff`) and each
-- ride rating (`rpc_ride_rate`) now grants 2 points to the rater through `karma_grant_once`, whose
-- de-duplication covers the new `rating_given` event: one award per handoff and rater, and per
-- ride, rater and ratee. Editing a handoff rating does not award again.
--
-- Function bodies are the current definitions with only the marked lines changed. Idempotent.

begin;

-- ── 1. `rating_given` joins the once-only event types ─────────────────────
drop index if exists public.karma_ledger_once_idx;
create unique index karma_ledger_once_idx on public.karma_ledger (user_id, event_type, ref_id)
  where event_type = any (array[
    'registration', 'post_created', 'outreach', 'backfill', 'listing_fulfilled',
    'volunteer_checkin', 'giving_handoff_giver', 'giving_handoff_receiver', 'rating_given'
  ]);

CREATE OR REPLACE FUNCTION public.karma_grant_once(p_user uuid, p_event text, p_ref_type text, p_ref_id text, p_delta integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_inserted integer;
begin
  if p_user is null then return; end if;
  insert into public.karma_ledger (user_id, event_type, points_delta, ref_type, ref_id)
  values (p_user, p_event, p_delta, p_ref_type, p_ref_id)
  on conflict (user_id, event_type, ref_id)
    where event_type in (
      'registration', 'post_created', 'outreach', 'backfill', 'listing_fulfilled',
      'volunteer_checkin', 'giving_handoff_giver', 'giving_handoff_receiver',
      'rating_given'  -- KC#1306
    )
    do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted > 0 then
    update public.users set karma_points = greatest(0, karma_points + p_delta)
     where user_id = p_user;
  end if;
end;
$function$;

-- ── 2. Handoff rating awards the rater ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rate_giving_handoff(p_handoff_id uuid, p_rating smallint, p_comment text DEFAULT NULL::text)
 RETURNS giving_handoff_ratings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_h public.giving_handoffs%rowtype;
  v_rater uuid := auth.uid();
  v_ratee uuid;
  v_row public.giving_handoff_ratings;
begin
  if v_rater is null then raise exception 'auth_required' using errcode = '42501'; end if;
  if p_rating < 1 or p_rating > 5 then raise exception 'invalid_rating' using errcode = '23514'; end if;

  select * into v_h from public.giving_handoffs where handoff_id = p_handoff_id and status = 'handed_over';
  if not found then raise exception 'handoff_not_found' using errcode = 'P0002'; end if;

  if v_rater = v_h.owner_id then v_ratee := v_h.recipient_id;
  elsif v_rater = v_h.recipient_id then v_ratee := v_h.owner_id;
  else raise exception 'not_participant' using errcode = '42501';
  end if;

  insert into public.giving_handoff_ratings (handoff_id, rater_id, ratee_id, rating, comment)
  values (p_handoff_id, v_rater, v_ratee, p_rating, nullif(trim(p_comment), ''))
  on conflict (handoff_id, rater_id) do update
    set rating = excluded.rating, comment = excluded.comment
  returning * into v_row;

  -- KC#1306: spec 07 §7.6 "Rating given — 2", once per handoff and rater (editing the rating
  -- or its note does not award again).
  perform public.karma_grant_once(v_rater, 'rating_given', 'giving_handoff_rating', p_handoff_id::text, 2);

  return v_row;
end;
$function$;

-- ── 3. Ride rating awards the rater ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_ride_rate(p_ride_id uuid, p_ratee_id uuid, p_stars integer, p_comment text DEFAULT NULL::text, p_is_penalty boolean DEFAULT false)
 RETURNS ride_ratings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- KC#1306: spec 07 §7.6 "Rating given — 2", once per (ride, rater, ratee).
  PERFORM public.karma_grant_once(v_uid, 'rating_given', 'ride_rating', p_ride_id::text || ':' || p_ratee_id::text, 2);

  RETURN v_row;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'rating_duplicate' USING ERRCODE = 'P0001';
END $function$;

commit;
