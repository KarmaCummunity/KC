-- Foundation · extensions
--
-- Created before the privilege file (020) on purpose: that file removes the default EXECUTE
-- grant from functions created after it, and extension functions and operators (PostGIS
-- distance, trigram match) must stay callable with a member's own rights inside queries
-- and policies — identically on Supabase and on a plain PostgreSQL server.
--
-- Installed into the platform's `extensions` schema, never into `public`, so extension
-- functions are not part of the API surface. Types and operator classes are therefore
-- written schema-qualified (`extensions.geography`, `extensions.gin_trgm_ops`).

-- Geography type and spatial indexes for every location in the product.
create extension if not exists postgis with schema extensions;

-- Trigram indexes: substring search over Hebrew names, where word stemming does not help.
create extension if not exists pg_trgm with schema extensions;

-- Lets a GIN index combine a plain equality column with a trigram column, so a name search
-- can be scoped to its parent row in one index (streets of one city).
create extension if not exists btree_gin with schema extensions;
