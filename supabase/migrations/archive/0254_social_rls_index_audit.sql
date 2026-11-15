-- 0254_social_rls_index_audit | KC#878 — policy-column indexes + STABLE helper refresh.
-- Complements docs/SSOT/social_realtime_conventions.md (EXPLAIN runbook).

-- Engagement tables: index FK / policy columns used in joins and RLS subqueries.
create index if not exists posts_post_id_owner_id_idx
  on public.posts (post_id, owner_id);

comment on index public.posts_post_id_owner_id_idx is
  'KC#878: supports engagement RLS owner/block lookups keyed by post_id.';

-- Ensure is_post_engagement_visible stays STABLE SECURITY DEFINER (idempotent).
create or replace function public.is_post_engagement_visible(p_post_id uuid, p_viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.posts p
     where p.post_id = p_post_id
       and public.is_post_visible_to(p.*, p_viewer)
  );
$$;
