-- 0051 | FR-POST-004 — extend Give item_condition with Damaged (שבור/תקול)
-- Unnamed column CHECK from 0002_init_posts.sql is named posts_item_condition_check.

set search_path = public;

alter table public.posts drop constraint posts_item_condition_check;

alter table public.posts
  add constraint posts_item_condition_check
  check (
    item_condition is null
    or item_condition in ('New', 'LikeNew', 'Good', 'Fair', 'Damaged')
  );
