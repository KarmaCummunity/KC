-- 0417_feed_visible_posts_view | Bug: the default 'newest' feed (PostgREST path) ignored
-- the viewer's post hides and mute filters (users / categories+worlds / keywords, #985).
--
-- A security-invoker view over posts that removes rows the viewer hid or muted. PostgREST
-- applies the same filters / keyset / order / limit on top and the view is inlined, so the
-- plan still walks posts_open_created_post_id_idx and stops after limit+1 visible rows:
--   - hides: hashed anti-join (feed_post_hides is per-user and small),
--   - mutes: per-row probe on feed_mute_filters (user_id) — no rows for most viewers.
-- Posts RLS (is_post_visible_to) still applies through security_invoker.
-- NOTE: `p.*` is expanded at creation time — re-create this view when posts gains columns
-- the feed needs.

begin;

create or replace view public.feed_visible_posts
with (security_invoker = true) as
select p.*
  from public.posts p
 where not exists (
         select 1
           from public.feed_post_hides h
          where h.user_id = (select auth.uid())
            and h.post_id = p.post_id
       )
   and not exists (
         select 1
           from public.feed_mute_filters mf
          where mf.user_id = (select auth.uid())
            and (
              (mf.filter_kind = 'user' and mf.filter_value = p.owner_id::text)
              or (mf.filter_kind in ('category', 'world') and mf.filter_value = p.category)
              or (mf.filter_kind = 'keyword' and (
                p.title ilike '%' || public.escape_ilike(mf.filter_value) || '%' escape '\'
                or coalesce(p.description, '') ilike '%' || public.escape_ilike(mf.filter_value) || '%' escape '\'
              ))
            )
       );

comment on view public.feed_visible_posts is
  'Feed source for signed-in viewers: posts minus the viewer''s hides and mutes (#985). RLS via security_invoker.';

revoke all on public.feed_visible_posts from public, anon;
grant select on public.feed_visible_posts to authenticated;

commit;
