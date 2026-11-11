-- 0148_ride_templates.sql — FR-RIDE-021 recurring ride templates.
--
-- Real commuter use case: "every Mon/Wed/Fri at 07:30, TLV → Haifa, 3 seats".
-- The template is the persistent intent; concrete `ride_listings` rows are
-- materialized from it daily, ahead of time, so they show up in feeds and
-- in inverse-mode search like any other ride.
--
-- Schema:
--   * ride_templates: one row per recurring slot (owner_id, route, mode,
--     day-of-week mask, time-of-day, default seats, optional description,
--     visibility tier, status, look-ahead window).
--   * ride_listings.template_id: nullable FK pointing back at the template
--     each materialized instance came from. ON DELETE SET NULL so deleting
--     a template doesn't wipe historical rides.
--
-- Materializer (separate pg_cron job, registered here):
--   * Runs daily at 02:00 UTC.
--   * For each active template, for each of the next N days (lookahead_days),
--     if the date's ISO day-of-week is in `weekday_mask` AND no instance
--     for (template_id, target_date) already exists, INSERT a new
--     ride_listings row with the template's route + the computed departs_at.
--   * The "no duplicate per day" check uses a partial unique index on
--     (template_id, date_trunc('day', departs_at)) so simultaneous runs
--     are safe.
--
-- Status machine (template-side):
--   active → paused (owner can stop without losing the template)
--   active → archived (owner is done; future materialization stops)
--   paused → active (resume)
--   paused → archived

BEGIN;

CREATE TABLE public.ride_templates (
  template_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         uuid NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
  mode             text NOT NULL CHECK (mode IN ('offer','request')),
  origin_city_id   text NOT NULL REFERENCES public.cities(city_id),
  dest_city_id     text NOT NULL REFERENCES public.cities(city_id),
  origin_street    text NOT NULL CHECK (char_length(origin_street) BETWEEN 1 AND 80),
  origin_street_number text CHECK (
    origin_street_number IS NULL OR char_length(origin_street_number) BETWEEN 1 AND 20
  ),
  dest_street      text NOT NULL CHECK (char_length(dest_street) BETWEEN 1 AND 80),
  dest_street_number   text CHECK (
    dest_street_number IS NULL OR char_length(dest_street_number) BETWEEN 1 AND 20
  ),
  depart_time      time NOT NULL,
  -- Bit mask of ISO day-of-week. Sun=1, Mon=2, Tue=4, Wed=8, Thu=16, Fri=32, Sat=64.
  -- A template that runs Mon+Wed+Fri has mask = 2+8+32 = 42.
  weekday_mask     int NOT NULL CHECK (weekday_mask BETWEEN 1 AND 127),
  seats_available  int CHECK (seats_available IS NULL OR (seats_available BETWEEN 1 AND 8)),
  description      text CHECK (description IS NULL OR char_length(description) <= 500),
  visibility       text NOT NULL DEFAULT 'Public'
    CHECK (visibility IN ('Public','FollowersOnly','OnlyMe')),
  status           text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','paused','archived')),
  lookahead_days   int NOT NULL DEFAULT 7 CHECK (lookahead_days BETWEEN 1 AND 30),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ride_templates_route_distinct CHECK (
    origin_city_id <> dest_city_id OR origin_street <> dest_street
  ),
  CONSTRAINT ride_templates_seats_by_mode CHECK (
    (mode = 'offer' AND seats_available IS NOT NULL)
    OR (mode = 'request' AND seats_available IS NULL)
  )
);

CREATE INDEX ride_templates_owner_idx
  ON public.ride_templates (owner_id, created_at DESC);

CREATE INDEX ride_templates_active_idx
  ON public.ride_templates (status)
  WHERE status = 'active';

CREATE TRIGGER ride_templates_set_updated_at
  BEFORE UPDATE ON public.ride_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Link instance ⇒ template.
ALTER TABLE public.ride_listings
  ADD COLUMN template_id uuid REFERENCES public.ride_templates(template_id) ON DELETE SET NULL;

-- Idempotency on materialization: at most one instance per (template, day).
CREATE UNIQUE INDEX ride_listings_template_day_unique
  ON public.ride_listings (template_id, ((departs_at AT TIME ZONE 'UTC')::date))
  WHERE template_id IS NOT NULL;

ALTER TABLE public.ride_templates ENABLE ROW LEVEL SECURITY;

-- SELECT: owner sees their own; nothing else (templates are private intent).
CREATE POLICY ride_templates_select_own ON public.ride_templates
  FOR SELECT TO authenticated USING (owner_id = auth.uid());

CREATE POLICY ride_templates_insert_own ON public.ride_templates
  FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());

CREATE POLICY ride_templates_update_own ON public.ride_templates
  FOR UPDATE TO authenticated USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY ride_templates_delete_own ON public.ride_templates
  FOR DELETE TO authenticated USING (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Materializer
-- ---------------------------------------------------------------------------
-- Generates ride_listings rows for the next lookahead_days days of every
-- active template. Idempotent: the partial unique index above swallows
-- duplicate per-day inserts.
CREATE OR REPLACE FUNCTION public.ride_templates_materialize()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  t          public.ride_templates;
  d          int;
  target     date;
  target_dow int;
  inserted_count int := 0;
  v_title    text;
  v_origin_name text;
  v_dest_name   text;
BEGIN
  FOR t IN
    SELECT * FROM public.ride_templates WHERE status = 'active'
  LOOP
    -- Resolve city names once per template for the auto-generated title.
    SELECT name_he INTO v_origin_name FROM public.cities WHERE city_id = t.origin_city_id;
    SELECT name_he INTO v_dest_name   FROM public.cities WHERE city_id = t.dest_city_id;
    v_origin_name := coalesce(v_origin_name, '?');
    v_dest_name   := coalesce(v_dest_name, '?');

    FOR d IN 0 .. t.lookahead_days - 1 LOOP
      target := (current_date + d);
      -- Postgres EXTRACT(ISODOW) is 1..7 (Mon..Sun); convert to our mask base
      -- where Sun=1, Mon=2, ..., Sat=64.
      target_dow := EXTRACT(ISODOW FROM target)::int;
      target_dow := CASE target_dow WHEN 7 THEN 1 ELSE target_dow + 1 END;

      IF (t.weekday_mask & (1 << (target_dow - 1))) = 0 THEN
        CONTINUE;
      END IF;

      -- Compose title as "{origin} → {dest} · YYYY-MM-DD HH24:MI".
      v_title := v_origin_name || ' → ' || v_dest_name
                 || ' · ' || to_char(target, 'YYYY-MM-DD')
                 || ' ' || to_char(t.depart_time, 'HH24:MI');

      BEGIN
        INSERT INTO public.ride_listings (
          owner_id, mode, origin_city_id, dest_city_id,
          origin_street, origin_street_number, dest_street, dest_street_number,
          departs_at, seats_available, description, title, visibility,
          template_id
        ) VALUES (
          t.owner_id, t.mode, t.origin_city_id, t.dest_city_id,
          t.origin_street, t.origin_street_number, t.dest_street, t.dest_street_number,
          (target + t.depart_time)::timestamptz, t.seats_available, t.description,
          left(v_title, 120), t.visibility, t.template_id
        );
        inserted_count := inserted_count + 1;
      EXCEPTION WHEN unique_violation THEN
        -- Already materialized for this (template, day) — skip silently.
        NULL;
      END;
    END LOOP;
  END LOOP;
  RETURN inserted_count;
END $$;

REVOKE ALL ON FUNCTION public.ride_templates_materialize() FROM public;
GRANT EXECUTE ON FUNCTION public.ride_templates_materialize() TO service_role;

SELECT cron.unschedule('ride_templates_materialize')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ride_templates_materialize');

SELECT cron.schedule(
  'ride_templates_materialize',
  '0 2 * * *',
  $$ SELECT public.ride_templates_materialize(); $$
);

COMMIT;
