-- 0109_legal_documents_public_read.sql
-- Grant anon SELECT on legal documents, superseding D-46.
--
-- Why this changes 0108's posture:
-- D-46 (2026-05-25) restricted legal_documents + legal_document_versions to
-- `authenticated` on the rationale that sign-up always happens through OAuth
-- before any legal text is read. In practice that breaks three flows:
--   (a) Sessions expire / refresh-token fails silently — the React store still
--       thinks the user is signed in, but the Supabase client falls back to
--       anon and PostgREST returns PGRST205 (table not in schema cache).
--   (b) Pre-sign-up readers ("let me see the terms before I commit") have no
--       way in — the AuthGate redirects them to /(auth), where the welcome
--       screen's "Terms" / "Privacy" links land on /legal/* and 404.
--   (c) Public deep links to /legal/terms shared by anyone — recipient must
--       sign in to read a document that is, by definition, public.
--
-- Acceptance writes (user_legal_acceptances) remain authenticated-only; only
-- the *read* surface for the published document content moves to public.
-- D-47 in DECISIONS.md captures the supersession.

begin;

-- Replace the authenticated-only SELECT policies with public ones. We still
-- list `to public` (covers anon + authenticated) explicitly rather than
-- removing the role list, so the policy intent stays grep-friendly.
drop policy if exists legal_documents_select_authenticated on public.legal_documents;
drop policy if exists legal_document_versions_select_authenticated on public.legal_document_versions;

drop policy if exists legal_documents_select_public on public.legal_documents;
create policy legal_documents_select_public
  on public.legal_documents
  for select to anon, authenticated
  using (true);

drop policy if exists legal_document_versions_select_public on public.legal_document_versions;
create policy legal_document_versions_select_public
  on public.legal_document_versions
  for select to anon, authenticated
  using (true);

-- GRANTs follow the policies. Without these PostgREST hides the table from
-- anon's schema cache and returns 404 (PGRST205) before RLS even runs.
grant select on public.legal_documents          to anon;
grant select on public.legal_document_versions  to anon;

-- user_legal_acceptances stays authenticated-only — anon has no identity to
-- own an acceptance row. (No-op statement here, but kept as documentation:
-- the prior policies / grants from 0108 remain unchanged.)

commit;
