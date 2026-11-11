-- 0340_feed_hot_path_indexes | KC#899 / epic #891 — hot-path indexes (EXPLAIN verified in tests).

begin;

-- Newest-feed cursor pagination (open posts, all visibilities — filtered in RPC).
create index if not exists posts_open_created_post_id_idx
  on public.posts (created_at desc, post_id desc)
  where status = 'open';

comment on index public.posts_open_created_post_id_idx is
  'KC#899: index-only friendly newest feed scan + keyset pagination.';

-- Filtered open feed (type/category) without full table seq scan.
create index if not exists posts_open_type_category_created_idx
  on public.posts (type, category, created_at desc, post_id desc)
  where status = 'open';

-- Anti-join for feed_post_hides (user_id already leading in feed_post_hides_user_idx).
create index if not exists feed_post_hides_post_user_idx
  on public.feed_post_hides (post_id, user_id);

-- Personalized ranking: viewer reactions probe by user then post join.
create index if not exists post_reactions_user_post_idx
  on public.post_reactions (user_id, post_id);

-- Visibility helper: closed_delivered recipient lookup.
create index if not exists recipients_post_recipient_user_idx
  on public.recipients (post_id, recipient_user_id)
  where recipient_user_id is not null;

-- Followers-only feed branch.
create index if not exists follow_edges_follower_followed_idx
  on public.follow_edges (follower_id, followed_id);

commit;
