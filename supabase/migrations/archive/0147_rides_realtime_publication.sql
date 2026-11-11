-- 0147_rides_realtime_publication.sql — FR-RIDE-016 add rides tables to supabase_realtime.
--
-- Mirrors the existing pattern (0007 for users, posts in 0002). RLS still gates
-- per-row visibility on broadcast — subscribers only see rides their SELECT
-- policy lets them see.
--
-- ride_listings: public-feed "↑ N new rides" pill on the hub, and live updates
--                when a ride the viewer is watching transitions states.
-- ride_participants: owner sees new join requests live; participant sees status
--                    transitions on their own row live.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename  = 'ride_listings'
    ) THEN
      EXECUTE 'alter publication supabase_realtime add table public.ride_listings';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename  = 'ride_participants'
    ) THEN
      EXECUTE 'alter publication supabase_realtime add table public.ride_participants';
    END IF;
  END IF;
END $$;
