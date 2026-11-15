-- 0122_ride_listings.sql — FR-RIDE-001..007, FR-RIDE-005

CREATE TABLE public.ride_listings (
  ride_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          uuid NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
  mode              text NOT NULL CHECK (mode IN ('offer','request')),
  origin_city_id    text NOT NULL REFERENCES public.cities(city_id),
  dest_city_id      text NOT NULL REFERENCES public.cities(city_id),
  departs_at        timestamptz NOT NULL,
  seats_available   int CHECK (seats_available IS NULL OR (seats_available BETWEEN 1 AND 8)),
  description       text CHECK (description IS NULL OR char_length(description) <= 500),
  title             text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  status            text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','closed','cancelled')),
  visibility        text NOT NULL DEFAULT 'Public'
    CHECK (visibility IN ('Public','FollowersOnly','OnlyMe')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ride_listings_origin_dest_diff CHECK (origin_city_id <> dest_city_id),
  CONSTRAINT ride_listings_seats_by_mode CHECK (
    (mode = 'offer' AND seats_available IS NOT NULL)
    OR (mode = 'request' AND seats_available IS NULL)
  )
);

CREATE INDEX ride_listings_open_depart_idx
  ON public.ride_listings (departs_at ASC)
  WHERE status = 'open';

CREATE INDEX ride_listings_route_idx
  ON public.ride_listings (origin_city_id, dest_city_id)
  WHERE status = 'open';

CREATE TRIGGER ride_listings_set_updated_at
  BEFORE UPDATE ON public.ride_listings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Chat anchor (FR-RIDE-005)
ALTER TABLE public.chats
  ADD COLUMN anchor_ride_id uuid NULL
    REFERENCES public.ride_listings(ride_id) ON DELETE SET NULL;

ALTER TABLE public.chats
  ADD CONSTRAINT chats_single_anchor_chk CHECK (
    NOT (anchor_post_id IS NOT NULL AND anchor_ride_id IS NOT NULL)
  );

-- RLS
ALTER TABLE public.ride_listings ENABLE ROW LEVEL SECURITY;

CREATE POLICY ride_listings_select_visible ON public.ride_listings
  FOR SELECT TO authenticated
  USING (
    (status = 'open' AND visibility = 'Public')
    OR owner_id = auth.uid()
  );

CREATE POLICY ride_listings_insert_own ON public.ride_listings
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY ride_listings_update_own ON public.ride_listings
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- Search RPC (FR-RIDE-002) — city names via name_he
CREATE OR REPLACE FUNCTION public.ride_listings_search(
  p_query text DEFAULT NULL,
  p_origin_city_id text DEFAULT NULL,
  p_dest_city_id text DEFAULT NULL,
  p_mode text DEFAULT NULL,
  p_depart_from timestamptz DEFAULT NULL,
  p_depart_to timestamptz DEFAULT NULL,
  p_limit int DEFAULT 30,
  p_cursor timestamptz DEFAULT NULL
)
RETURNS SETOF public.ride_listings
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.*
  FROM public.ride_listings r
  LEFT JOIN public.cities oc ON oc.city_id = r.origin_city_id
  LEFT JOIN public.cities dc ON dc.city_id = r.dest_city_id
  WHERE r.status = 'open'
    AND r.visibility = 'Public'
    AND (p_mode IS NULL OR r.mode = p_mode)
    AND (p_origin_city_id IS NULL OR r.origin_city_id = p_origin_city_id)
    AND (p_dest_city_id IS NULL OR r.dest_city_id = p_dest_city_id)
    AND (p_depart_from IS NULL OR r.departs_at >= p_depart_from)
    AND (p_depart_to IS NULL OR r.departs_at <= p_depart_to)
    AND (p_cursor IS NULL OR r.departs_at > p_cursor)
    AND (
      p_query IS NULL OR char_length(trim(p_query)) < 2
      OR r.title ILIKE '%' || replace(replace(trim(p_query), '%', '\%'), '_', '\_') || '%'
      OR r.description ILIKE '%' || replace(replace(trim(p_query), '%', '\%'), '_', '\_') || '%'
      OR oc.name_he ILIKE '%' || replace(replace(trim(p_query), '%', '\%'), '_', '\_') || '%'
      OR dc.name_he ILIKE '%' || replace(replace(trim(p_query), '%', '\%'), '_', '\_') || '%'
    )
  ORDER BY r.departs_at ASC
  LIMIT LEAST(GREATEST(p_limit, 1), 50);
$$;

GRANT EXECUTE ON FUNCTION public.ride_listings_search TO authenticated;

-- Re-anchor post: clear ride anchor when setting post (FR-RIDE-005)
CREATE OR REPLACE FUNCTION public.rpc_chat_set_anchor(
  p_chat_id uuid,
  p_anchor_post_id uuid
)
RETURNS public.chats
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.chats;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_row
  FROM public.chats
  WHERE chat_id = p_chat_id;

  IF v_row.chat_id IS NULL THEN
    RAISE EXCEPTION 'chat_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_row.participant_a <> v_uid AND v_row.participant_b <> v_uid THEN
    RAISE EXCEPTION 'not_participant' USING ERRCODE = 'P0001';
  END IF;

  IF v_row.anchor_post_id IS NOT DISTINCT FROM p_anchor_post_id
     AND v_row.anchor_ride_id IS NULL THEN
    RETURN v_row;
  END IF;

  UPDATE public.chats
     SET anchor_post_id = p_anchor_post_id,
         anchor_ride_id = NULL
   WHERE chat_id = p_chat_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- Ride anchor RPC — mirrors 0027_rpc_chat_set_anchor
CREATE OR REPLACE FUNCTION public.rpc_chat_set_anchor_ride(
  p_chat_id uuid,
  p_anchor_ride_id uuid
)
RETURNS public.chats
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.chats;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_row
  FROM public.chats
  WHERE chat_id = p_chat_id;

  IF v_row.chat_id IS NULL THEN
    RAISE EXCEPTION 'chat_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_row.participant_a <> v_uid AND v_row.participant_b <> v_uid THEN
    RAISE EXCEPTION 'not_participant' USING ERRCODE = 'P0001';
  END IF;

  IF v_row.anchor_ride_id IS NOT DISTINCT FROM p_anchor_ride_id
     AND v_row.anchor_post_id IS NULL THEN
    RETURN v_row;
  END IF;

  UPDATE public.chats
     SET anchor_ride_id = p_anchor_ride_id,
         anchor_post_id = NULL
   WHERE chat_id = p_chat_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_chat_set_anchor_ride(uuid, uuid) TO authenticated;
