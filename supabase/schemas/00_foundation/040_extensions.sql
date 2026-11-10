-- Foundation · extensions
--
-- Installed into the platform's `extensions` schema, never into `public`, so extension
-- functions are not part of the API surface. Types and operator classes are therefore
-- written schema-qualified (`extensions.geography`, `extensions.gin_trgm_ops`).

-- Geography type and spatial indexes for every location in the product.
create extension if not exists postgis with schema extensions;

-- Trigram indexes: substring search over Hebrew names, where word stemming does not help.
create extension if not exists pg_trgm with schema extensions;
