-- 0187_post_estimated_value | FR-KARMA-004 — optional estimated item value (Give posts)
-- 0..1000; null = unset. Feeds the karma closure value bonus (0189). The slider
-- only renders for Give in the client; the column is generic (no type CHECK so a
-- future Request-value variant needs no schema change — D-155 / non-goal note).
--
-- Grants (verified against dev 2026-06-01): posts INSERT is table-level for
-- `authenticated` (new column auto-covered); UPDATE is column-scoped, so
-- estimated_value is added to the UPDATE grant for edit-post. No posts column
-- write-guard trigger exists, so the value is not silently dropped.

alter table public.posts
  add column if not exists estimated_value integer
    check (estimated_value is null or (estimated_value >= 0 and estimated_value <= 1000));

grant update (estimated_value) on public.posts to authenticated;

-- end of 0187_post_estimated_value
