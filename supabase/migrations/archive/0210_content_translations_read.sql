-- 0210_content_translations_read — FR-TRANSLATE-002 (Phase 1c, posts read path).
-- Replaces the Phase-1a deny-by-default SELECT policy on content_translations
-- with a narrow policy that reuses the posts visibility predicate, and adds a
-- SECURITY INVOKER read RPC that returns cached post translations for the
-- reader's target language. See design §5 (read path — posts), §9 (RLS reuse).
-- Closes TD-58.

-- ── Narrow read policy ────────────────────────────────────────────────────
-- Authenticated readers may SELECT a translation row only when (a) it belongs
-- to a post and (b) that post is visible to them. The EXISTS subquery runs as
-- the invoking user, so the posts `posts_select_visible` RLS (is_post_visible_to)
-- naturally filters it — we reuse the same predicate instead of duplicating
-- visibility logic. Message (chat) translations stay unreadable here; chat is
-- Phase 3 with its own consent-gated policy. Service role bypasses RLS for the
-- translate pipeline writes.
drop policy if exists content_translations_no_direct_read on public.content_translations;
drop policy if exists content_translations_select_visible_post on public.content_translations;
create policy content_translations_select_visible_post
  on public.content_translations
  for select
  to authenticated
  using (
    content_type = 'post'
    and exists (
      select 1
        from public.posts p
       where p.post_id = content_translations.content_id
    )
  );

-- ── Read RPC ──────────────────────────────────────────────────────────────
-- Returns cache HITS only (misses are simply absent rows; the app materializes
-- them via ITranslationService). SECURITY INVOKER: the join to `posts` is
-- filtered by posts RLS first, so translations for invisible posts are
-- unreachable. Batched by post id + single target language (one round-trip for
-- a feed page). No write, no LLM call on this path.
create or replace function public.get_post_translations(
  p_post_ids uuid[],
  p_target_language text
)
returns table (
  post_id uuid,
  field text,
  source_language text,
  translated_text text,
  confidence real
)
language sql
security invoker
stable
set search_path = public
as $$
  select ct.content_id as post_id,
         ct.field,
         ct.source_language,
         ct.translated_text,
         ct.confidence
    from public.posts p
    join public.content_translations ct
      on ct.content_type = 'post'
     and ct.content_id = p.post_id
     and ct.target_language = p_target_language
   where p.post_id = any (p_post_ids);
$$;

comment on function public.get_post_translations(uuid[], text) is
  'FR-TRANSLATE-002 Phase 1c. SECURITY INVOKER read path: returns cached post '
  'translations (title/description) for the given post ids in the reader''s '
  'target language. Posts RLS filters visibility first; returns hits only.';

revoke all on function public.get_post_translations(uuid[], text) from public, anon;
grant execute on function public.get_post_translations(uuid[], text) to authenticated;
