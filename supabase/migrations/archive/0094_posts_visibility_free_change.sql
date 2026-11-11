-- FR-POST-009 (revised 2026-05-17, D-32): allow any posts.visibility transition.
-- Supersedes trigger posts_visibility_upgrade_only from 0002_init_posts.sql.

drop trigger if exists posts_visibility_upgrade_only on public.posts;

drop function if exists public.posts_visibility_upgrade_check();
