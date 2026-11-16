-- Demo data tools (FR-ADMIN-031): installs the functions behind the admin portal's Demo data
-- screen. DEV ONLY: run against kc-dev (Seed KC dev workflow, action `demo`), a local stack or a
-- scratch test database, never kc-prod. The production baseline holds no seed, demo or dev
-- object (docs/db/target-design.md §6); this is the dev-only seed script that §9 names.
--
-- Safe to run again: tables are created if missing and functions replaced. Installing does
-- not mark the database as kc-dev and creates no demo data: load.sql does both.
-- Run in one transaction: psql --single-transaction -f install.sql (paths are relative to it).
\ir lib/10_scope.sql
\ir lib/20_wipe.sql
\ir lib/30_seed_members.sql
\ir lib/40_seed_posts.sql
\ir lib/50_seed_social.sql
\ir lib/60_seed_orgs.sql
\ir lib/70_operations.sql
\ir lib/80_admin_rpcs.sql
