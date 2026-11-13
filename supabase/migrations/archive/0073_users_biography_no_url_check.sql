-- ─────────────────────────────────────────────
-- Migration 0073 — TD-155 / FR-PROFILE-014
-- Server-side anti-spam URL filter on `users.biography`.
--
-- Mirrors the client-side `containsBiographyUrl` policy in
-- `@kc/domain` (`value-objects.ts:BIOGRAPHY_URL_PATTERN`). The two
-- sources MUST stay in sync — when one moves, edit both together. The
-- regex grammar is intentionally PCRE-portable (no JS-only features)
-- so `biography !~* '...'` here matches exactly what the JS regex
-- catches.
--
-- Pattern rejects, case-insensitively:
--   - `http://`, `https://`     (raw URLs)
--   - `www.`                    (URL-without-scheme)
--   - `<word>.<2+ letters>`     (bare domains incl. `bit.ly`, `t.co`,
--                                `tinyurl`, plus any domain-shaped
--                                token in a sentence).
--
-- Constraint is added `NOT VALID` so existing rows that already
-- contain URLs are preserved (per FR-PROFILE-014 AC4: legacy bios are
-- flagged for moderation review rather than retroactively erased).
-- Future UPDATEs and INSERTs are enforced.
--
-- Idempotent: drops then recreates by the same name, both with NOT
-- VALID. Safe to re-apply.
-- ─────────────────────────────────────────────

alter table public.users
  drop constraint if exists users_biography_no_url_check;

alter table public.users
  add constraint users_biography_no_url_check
  check (
    biography is null
    or biography !~* '(https?://|www\.|[\w.-]+\.[a-z]{2,})'
  )
  not valid;
