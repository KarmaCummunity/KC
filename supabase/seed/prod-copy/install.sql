-- Production copy tools (FR-ADMIN-037): the functions that add the weekly anonymized copy of
-- production to kc-dev. DEV ONLY: run against kc-dev (every dev deploy does), a local stack or
-- a scratch test database, never kc-prod (docs/db/target-design.md §6, §9; decision D-239).
--
-- Safe to run again: tables are created if missing and functions replaced. Installing does
-- not mark the database as kc-dev and copies nothing: load.sql sets the marker.
-- Run in one transaction: psql --single-transaction -f install.sql (paths are relative to it).
\ir lib/10_scope.sql
\ir lib/20_members.sql
\ir lib/30_posts.sql
\ir lib/40_social.sql
\ir lib/50_apply.sql
