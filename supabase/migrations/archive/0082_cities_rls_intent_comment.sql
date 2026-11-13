-- 0082_cities_rls_intent_comment | Closes audit 2026-05-10 §15.15.
--
-- The audit flagged `cities` as having "theatrical RLS" — enabled with a
-- permissive `select using (true)` policy. The framing was misleading:
-- enabling RLS while writing only a SELECT policy *is* the protection model
-- (it blocks INSERT/UPDATE/DELETE by default for anon + authenticated, even
-- though they have INSERT-class grants via PostgREST). Cities is a reference
-- table that should never be writable by clients; future code that adds an
-- INSERT policy by mistake would expose the table to data tampering.
--
-- Add an explicit COMMENT recording the intent so a reader doesn't propose
-- relaxing RLS on the table.

comment on policy cities_select_all on public.cities is
  'Public reference data (city catalog). Reads are intentionally open. RLS is '
  'enabled to block INSERT/UPDATE/DELETE by default — do not add a write '
  'policy without a clear admin-only gate (audit 2026-05-10 §15.15).';

comment on table public.cities is
  'Reference table: Israeli city catalog. Public-read via RLS; writes only '
  'via migrations / service-role (audit 2026-05-10 §15.15).';

-- end 0082_cities_rls_intent_comment
