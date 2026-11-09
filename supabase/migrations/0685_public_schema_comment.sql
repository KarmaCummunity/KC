-- 0685_public_schema_comment — reset the public schema comment (#1961).
-- The comment set by an old version named a retired product (D-190). Restore the
-- default text that a fresh stack already has.
comment on schema public is 'standard public schema';
