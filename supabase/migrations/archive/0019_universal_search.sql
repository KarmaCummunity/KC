-- 0019_universal_search | P2.6 — Universal Smart Search
-- FR-FEED-017+ (universal search engine replacing the FR-FEED-016 placeholder)
--
-- Adds full-text search support via Postgres tsvector + GIN indexes on posts,
-- users, and donation_links. Uses 'simple' text-search config because Postgres
-- has no built-in Hebrew stemmer; callers compensate with prefix matching (:*)
-- at query time. Also adds a free-text `tags` column on donation_links for
-- extra keyword-based discoverability (e.g. "תרומות,כסף,נתינה,jgive").

-- ── 1. donation_links: tags column ───────────────────────────────────────────
ALTER TABLE public.donation_links
  ADD COLUMN IF NOT EXISTS tags text;

COMMENT ON COLUMN public.donation_links.tags IS
  'Free-text comma-separated keywords for search discoverability (e.g. "תרומות,כסף,נתינה")';

-- Grant UPDATE on the new column to authenticated (same authz as existing columns).
GRANT UPDATE (tags) ON public.donation_links TO authenticated;

-- ── 2. posts: full-text search vector ────────────────────────────────────────
-- Covers title + description + category for broad match.
-- 'simple' config: no stemming, just lowercasing + whitespace tokenization.
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple',
      coalesce(title, '') || ' ' ||
      coalesce(description, '') || ' ' ||
      coalesce(category, '')
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS posts_search_gin_idx
  ON public.posts USING GIN (search_vector);

-- ── 3. users: full-text search vector ────────────────────────────────────────
-- Covers display_name + biography + share_handle.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple',
      coalesce(display_name, '') || ' ' ||
      coalesce(biography, '') || ' ' ||
      coalesce(share_handle, '')
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS users_search_gin_idx
  ON public.users USING GIN (search_vector);

-- ── 4. donation_links: full-text search vector ──────────────────────────────
-- Covers display_name + description + url + tags + category_slug.
ALTER TABLE public.donation_links
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple',
      coalesce(display_name, '') || ' ' ||
      coalesce(description, '') || ' ' ||
      coalesce(url, '') || ' ' ||
      coalesce(tags, '') || ' ' ||
      coalesce(category_slug, '')
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS donation_links_search_gin_idx
  ON public.donation_links USING GIN (search_vector);
