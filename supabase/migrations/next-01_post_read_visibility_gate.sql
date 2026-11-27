-- Social · post reads check visibility once (NFR-PERF-005)
--
-- `post_cards`, `post_comments_page` and `post_detail` ran every lookup under row-level security.
-- The side-table policies (`post_stats`, `post_media`, `post_reactions`, `challenges`,
-- `post_comments`, `post_comment_reactions`) each re-check that the post is readable with
-- `exists (select 1 from posts ...)`. That re-expands every `posts` policy, and with them the
-- `users`, `follows`, `post_handoffs` and `report_hides` policies, for each table a read touches.
-- These are SQL functions with `set search_path`, so PostgreSQL never inlines them and plans
-- them again on every call. One card planned about 70 sub-plans and 200 init-plans, and each
-- call was CPU work out of proportion to the few rows it returns. Under QA traffic on the small
-- kc-dev instance, that work is what pushed these reads (and writes queued behind them, such
-- as `confirm_item_handoff`) to the 8 s statement timeout (57014).
--
-- The reads now ask row-level security only what it decides:
--   * `post_cards` reads `posts` joined to the owner in `users` under the caller's rights, so
--     the post's and the owner's policies pick the cards exactly as before. Then
--     `kc_access.post_card_rows` builds those cards without the policies. Every side row it
--     reads belongs to a post the caller has just been allowed to read. For such rows the
--     side-table policies reduce to that same check, so the values are the same.
--   * `post_comments_page` picks its page of comments under the caller's rights (comment and
--     author policies, as before). It counts replies under the caller's rights, as before.
--     It counts likes over the like rows of those comments joined to `users` under the
--     caller's rights: that is the like policy once the comment is known to be readable.
--     `kc_access.post_comment_rows` then shapes the page.
--   * `post_detail` reads the gallery of the card it just read with `kc_access.post_gallery`:
--     the `post_media` policy for a ready file of a readable post.
--
-- The `kc_access` workers are `security definer`, so each one checks for itself that the caller
-- may read what it is given, with three predicates that mirror the row-level security policies
-- of `users`, `posts` and `post_comments` (`viewer_can_read_user`, `viewer_can_read_post`,
-- `viewer_can_read_comment`). A worker therefore returns nothing for an id the caller cannot
-- read, even when it is called directly: the exposed-schema setting is a second line of defence,
-- not the only boundary. The workers are executable by `authenticated` and `service_role`, never
-- by `anon` or PUBLIC; `kc_access` is not an API schema (PostgREST serves `public` only). If a
-- policy of these tables changes, the predicates change with it; supabase/tests/135 compares every
-- worker with the policies themselves, for every kind of member, so a drift fails there.
-- The `public` signatures and results are unchanged, so the generated database types do not move.
--
-- Rollback: re-create `public.post_cards` from `0074_post_card_provenance.sql`, and
-- `public.post_comments_page` and `public.post_detail` from `0001_baseline.sql` (they are
-- `create or replace`, same signatures), then drop the four `kc_access` workers and the three `viewer_can_read_*` predicates below.

-- ── What the caller may read (mirrors the row-level security policies) ───────────────────────
-- Each predicate answers for the signed-in caller (`auth.uid()`); a signed-out caller reads
-- nothing. They are the policies in 0001_baseline.sql restated for one id:
--   users          `users_select_active_or_self` or `users_select_staff`, and neither
--                  `users_hide_blocked` nor `users_hide_reported` (staff are exempt from the latter)
--   posts          `posts_select_owner`, `_staff`, `_org_admin`, `_visible`, `_handoff_party`, and not
--                  `posts_hide_reported` (staff exempt). `_visible` and `_handoff_party` need the
--                  owner's profile to be readable, which is the `users` predicate.
--   post_comments  `post_comments_select_visible` or `_staff`, and not `post_comments_hide_reported`

create function kc_access.viewer_can_read_user(p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_viewer constant uuid := (select auth.uid());
  v_admin boolean;
begin
  if v_viewer is null or p_user_id is null then
    return false;
  end if;
  v_admin := (select kc_access.is_admin());
  return exists (
    select 1 from public.users u
     where u.id = p_user_id
       and (u.is_active or u.id = v_viewer or v_admin)
       and not kc_access.is_blocked_between(v_viewer, u.id)
       and (v_admin or not exists (select 1 from public.report_hides h
                                    where h.reporter_id = v_viewer
                                      and h.target_type = 'user' and h.target_id = u.id)));
end;
$$;
comment on function kc_access.viewer_can_read_user(uuid) is
  'Whether the caller may read this member under the users policies (worker guard for post reads).';
revoke all on function kc_access.viewer_can_read_user(uuid) from public, anon;
grant execute on function kc_access.viewer_can_read_user(uuid) to authenticated, service_role;

create function kc_access.viewer_can_read_post(p_post_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_viewer constant uuid := (select auth.uid());
  v_admin boolean;
begin
  if v_viewer is null or p_post_id is null then
    return false;
  end if;
  v_admin := (select kc_access.is_admin());
  return exists (
    select 1 from public.posts p
     where p.id = p_post_id
       and (p.owner_id = v_viewer
            or v_admin
            or p.beneficiary_org_id = any ((select kc_access.managed_org_ids())::uuid[])
            or (p.status in ('open', 'closed_delivered')
                and kc_access.viewer_can_read_user(p.owner_id)
                and (p.visibility = 'Public'
                     or (p.visibility = 'FollowersOnly'
                         and exists (select 1 from public.follows f
                                      where f.follower_id = v_viewer and f.followed_id = p.owner_id))
                     or exists (select 1 from public.post_handoffs h
                                 where h.post_id = p.id and h.recipient_id = v_viewer
                                   and h.status <> 'cancelled'))))
       and (v_admin or not exists (select 1 from public.report_hides h
                                    where h.reporter_id = v_viewer
                                      and h.target_type = 'post' and h.target_id = p.id)));
end;
$$;
comment on function kc_access.viewer_can_read_post(uuid) is
  'Whether the caller may read this post under the posts policies (worker guard for post reads).';
revoke all on function kc_access.viewer_can_read_post(uuid) from public, anon;
grant execute on function kc_access.viewer_can_read_post(uuid) to authenticated, service_role;

create function kc_access.viewer_can_read_comment(p_comment_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_viewer constant uuid := (select auth.uid());
  v_admin boolean;
begin
  if v_viewer is null or p_comment_id is null then
    return false;
  end if;
  v_admin := (select kc_access.is_admin());
  return exists (
    select 1 from public.post_comments c
     where c.id = p_comment_id
       and (v_admin
            or (c.status = 'active'
                and kc_access.viewer_can_read_post(c.post_id)
                and kc_access.viewer_can_read_user(c.author_id)))
       and (v_admin or not exists (select 1 from public.report_hides h
                                    where h.reporter_id = v_viewer
                                      and h.target_type = 'comment' and h.target_id = c.id)));
end;
$$;
comment on function kc_access.viewer_can_read_comment(uuid) is
  'Whether the caller may read this comment under the post_comments policies (worker guard for post reads).';
revoke all on function kc_access.viewer_can_read_comment(uuid) from public, anon;
grant execute on function kc_access.viewer_can_read_comment(uuid) to authenticated, service_role;

-- ── Workers (no row-level security: each one keeps only what the caller may read) ─────────

create or replace function kc_access.post_card_rows(p_post_ids uuid[])
returns setof public.post_card
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, case when mk.masked then null else p.owner_id end, p.world_slug, p.kind_id, p.post_type, p.direction, p.status, p.visibility,
         p.title, p.description, p.item_subcategory_id, p.details,
         p.city_id, c.name_he, c.name_en, p.location_display_level, p.time_window, p.urgency_level,
         p.expires_at, p.published_at, p.created_at,
         case when mk.masked then null else u.display_name end,
         case when mk.masked then null else u.share_handle end,
         case when mk.masked then null else u.avatar_url end,
         case when mk.masked then null else u.verification_level end,
         media.cover, coalesce(media.n, 0),
         coalesce(s.reactions_count, 0), coalesce(s.comments_count, 0), coalesce(s.shares_count, 0),
         (select r.reaction_type from public.post_reactions r
           where r.post_id = p.id and r.user_id = (select auth.uid())),
         exists (select 1 from public.saved_posts sp
                  where sp.user_id = (select auth.uid()) and sp.post_id = p.id),
         exists (select 1 from public.follows f
                  where f.follower_id = (select auth.uid()) and f.followed_id = p.owner_id)
           and not mk.masked,
         mk.masked,
         p.geo_approx::text, p.source_language, p.status_before_removal,
         p.shown_street, p.shown_street_number,
         (select ch.id from public.challenges ch where ch.post_id = p.id),
         p.source, p.source_platform
    from public.posts p
    cross join lateral (select kc_access.post_actor_masked(p.id, p.owner_id) as masked) mk
    join public.users u on u.id = p.owner_id
    join public.cities c on c.city_id = p.city_id
    left join public.post_stats s on s.post_id = p.id
    left join lateral (
      select count(*)::integer as n,
             (array_agg(kc_access.post_media_json(m) order by m.ordinal))[1] as cover
        from public.post_media m
       where m.post_id = p.id and m.processing_status = 'ready') media on true
   where p.id = any (p_post_ids[1:100])
     and kc_access.viewer_can_read_post(p.id)
     and kc_access.viewer_can_read_user(p.owner_id);
$$;
comment on function kc_access.post_card_rows(uuid[]) is
  'Cards of the listed posts the caller may read; applies no row-level security, the viewer_can_read_* predicates decide.';
revoke all on function kc_access.post_card_rows(uuid[]) from public, anon;
grant execute on function kc_access.post_card_rows(uuid[]) to authenticated, service_role;

create or replace function kc_access.post_comment_rows(p_comment_ids uuid[])
returns table (
  id uuid,
  post_id uuid,
  parent_comment_id uuid,
  author_id uuid,
  author_display_name text,
  author_share_handle text,
  author_avatar_url text,
  author_identity_masked boolean,
  body text,
  mention_user_ids uuid[],
  created_at timestamptz,
  edited_at timestamptz,
  next_cursor jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.post_id, c.parent_comment_id,
         case when mk.masked then null else c.author_id end,
         case when mk.masked then null else u.display_name end,
         case when mk.masked then null else u.share_handle end,
         case when mk.masked then null else u.avatar_url end,
         mk.masked, c.body, c.mention_user_ids, c.created_at, c.edited_at,
         jsonb_build_object('t', c.created_at, 'id', c.id)
    from public.post_comments c
    join public.users u on u.id = c.author_id
    cross join lateral (select kc_access.post_actor_masked(c.post_id, c.author_id) as masked) mk
   where c.id = any (p_comment_ids[1:50])
     and kc_access.viewer_can_read_comment(c.id)
     and kc_access.viewer_can_read_user(c.author_id);
$$;
comment on function kc_access.post_comment_rows(uuid[]) is
  'Comments the caller may read, with author and mask (post_comments_page).';
revoke all on function kc_access.post_comment_rows(uuid[]) from public, anon;
grant execute on function kc_access.post_comment_rows(uuid[]) to authenticated, service_role;

create or replace function kc_access.post_comment_reaction_rows(p_comment_ids uuid[])
returns table (comment_id uuid, user_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select r.comment_id, r.user_id
    from public.post_comment_reactions r
   where r.comment_id = any (p_comment_ids[1:50])
     and kc_access.viewer_can_read_comment(r.comment_id)
     and kc_access.viewer_can_read_user(r.user_id);
$$;
comment on function kc_access.post_comment_reaction_rows(uuid[]) is
  'Likes of comments the caller may read, by likers the caller may read.';
revoke all on function kc_access.post_comment_reaction_rows(uuid[]) from public, anon;
grant execute on function kc_access.post_comment_reaction_rows(uuid[]) to authenticated, service_role;

create or replace function kc_access.post_gallery(p_post_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(kc_access.post_media_json(m) order by m.ordinal), '[]'::jsonb)
    from public.post_media m
   where m.post_id = p_post_id and m.processing_status = 'ready'
     and (select kc_access.viewer_can_read_post(p_post_id));
$$;
comment on function kc_access.post_gallery(uuid) is
  'Ready files of a post the caller may read, in gallery order (post_detail).';
revoke all on function kc_access.post_gallery(uuid) from public, anon;
grant execute on function kc_access.post_gallery(uuid) to authenticated, service_role;

-- ── The API reads (same signatures and results) ──────────────────────────────────────────

create or replace function public.post_cards(p_post_ids uuid[])
returns setof public.post_card
language sql
stable
security invoker
set search_path = ''
as $$
  -- Row-level security decides here, once: the post's policies and its owner's.
  select c.*
    from kc_access.post_card_rows(array(
           select p.id
             from public.posts p
             join public.users u on u.id = p.owner_id
            where p.id = any (p_post_ids[1:100]))) c;
$$;
comment on function public.post_cards(uuid[]) is 'Cards of the listed posts that the caller can read.';
grant execute on function public.post_cards(uuid[]) to authenticated;

create or replace function public.post_comments_page(
  p_post_id uuid,
  p_parent_comment_id uuid default null,
  p_cursor jsonb default null,
  p_limit integer default 20
)
returns table (
  id uuid,
  post_id uuid,
  parent_comment_id uuid,
  author_id uuid,
  author_display_name text,
  author_share_handle text,
  author_avatar_url text,
  author_identity_masked boolean,
  body text,
  mention_user_ids uuid[],
  created_at timestamptz,
  edited_at timestamptz,
  reactions_count integer,
  replies_count integer,
  viewer_reacted boolean,
  next_cursor jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  -- The page, the replies counted and the likers are read under the caller's rights.
  with page as (
    select c.id
      from public.post_comments c
      join public.users u on u.id = c.author_id
     where c.post_id = p_post_id
       and c.parent_comment_id is not distinct from p_parent_comment_id
       and (p_cursor is null
            or (c.created_at, c.id) > ((p_cursor ->> 't')::timestamptz, (p_cursor ->> 'id')::uuid))
     order by c.created_at, c.id
     limit least(greatest(coalesce(p_limit, 20), 1), 50)
  ),
  replies as (
    select r.parent_comment_id as comment_id, count(*)::integer as n
      from public.post_comments r
     where r.parent_comment_id in (select page.id from page)
     group by r.parent_comment_id
  ),
  likes as (
    select l.comment_id, count(*)::integer as n, bool_or(l.user_id = (select auth.uid())) as mine
      from kc_access.post_comment_reaction_rows(array(select page.id from page)) l
      join public.users u on u.id = l.user_id
     group by l.comment_id
  )
  select w.id, w.post_id, w.parent_comment_id, w.author_id, w.author_display_name, w.author_share_handle,
         w.author_avatar_url, w.author_identity_masked, w.body, w.mention_user_ids, w.created_at, w.edited_at,
         coalesce(likes.n, 0), coalesce(replies.n, 0), coalesce(likes.mine, false), w.next_cursor
    from kc_access.post_comment_rows(array(select page.id from page)) w
    left join replies on replies.comment_id = w.id
    left join likes on likes.comment_id = w.id
   order by w.created_at, w.id;
$$;
comment on function public.post_comments_page(uuid, uuid, jsonb, integer) is
  'One keyset page of a post''s comments, or of a comment''s replies, oldest first.';
grant execute on function public.post_comments_page(uuid, uuid, jsonb, integer) to authenticated;

create or replace function public.post_detail(p_post_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'post', to_jsonb(card),
    'media', kc_access.post_gallery(card.id),
    'comments', (select coalesce(jsonb_agg(to_jsonb(k)), '[]'::jsonb)
                   from public.post_comments_page(card.id) k))
    from public.post_cards(array[p_post_id]) card;
$$;
comment on function public.post_detail(uuid) is
  'Post detail payload: card, media gallery and first page of comments; null when not readable.';
grant execute on function public.post_detail(uuid) to authenticated;
