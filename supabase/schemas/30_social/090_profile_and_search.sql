-- Social · profile post tabs and search
--
-- The remaining post lists and the member search. All run with the caller's rights, return
-- cards (or member rows) in one round trip and page by keyset.

-- One tab of a profile's posts, newest first (FR-PROFILE-001 AC4, FR-PROFILE-002):
--   open     open posts shown on the profile (never "only me")
--   closed   delivered posts; on one's own profile also posts deleted without a recipient,
--            which can still be reopened
--   hidden   the owner's "only me" posts — RLS returns them to nobody else
-- RLS narrows every tab to what the caller may read of that member. Keyset on
-- (created_at, id), served by posts_owner_recent_idx.
create function public.profile_posts_page(
  p_user_id uuid,
  p_cursor jsonb default null,
  p_limit integer default 20,
  p_tab text default 'open'
)
returns table (card public.post_card, next_cursor jsonb)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_post_ids uuid[];
begin
  if p_tab is null or p_tab not in ('open', 'closed', 'hidden') then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;

  v_post_ids := array(
    select p.id
      from public.posts p
     where p.owner_id = p_user_id
       and case p_tab
             when 'open' then p.status = 'open' and p.visibility <> 'OnlyMe'
             when 'closed' then p.status in ('closed_delivered', 'deleted_no_recipient')
                                and p.visibility <> 'OnlyMe'
             else p.status in ('open', 'closed_delivered') and p.visibility = 'OnlyMe' end
       and (p_cursor is null
            or (p.created_at, p.id) < ((p_cursor ->> 't')::timestamptz, (p_cursor ->> 'id')::uuid))
     order by p.created_at desc, p.id desc
     limit least(greatest(coalesce(p_limit, 20), 1), 50));

  return query
  select c, jsonb_build_object('t', c.created_at, 'id', c.id)
    from public.post_cards(v_post_ids) c
   order by c.created_at desc, c.id desc;
end;
$$;
comment on function public.profile_posts_page(uuid, jsonb, integer, text) is
  'One keyset page of a tab of a member''s posts (open, closed, hidden), as cards.';
grant execute on function public.profile_posts_page(uuid, jsonb, integer, text) to authenticated;

-- Post search: posts whose title or description contains the text (FR-FEED-016), newest
-- first unless p_filters names another sort. It is the feed query in search scope, so the
-- filters, the visibility rules and the paging are the feed's. Fewer than two characters
-- return nothing.
create function public.search_posts_page(
  p_query text,
  p_cursor jsonb default null,
  p_limit integer default 20,
  p_filters jsonb default '{}'::jsonb
)
returns table (card public.post_card, next_cursor jsonb, distance_m integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select f.card, f.next_cursor, f.distance_m
    from public.feed_page(
           p_cursor, p_limit,
           '{"sort": "newest"}'::jsonb || coalesce(p_filters, '{}'::jsonb)
             || jsonb_build_object('scope', 'search', 'q', btrim(p_query))) f
   where char_length(btrim(p_query)) >= 2;
$$;
comment on function public.search_posts_page(text, jsonb, integer, jsonb) is
  'One keyset page of posts matching a text, as cards; accepts the feed filters.';
grant execute on function public.search_posts_page(text, jsonb, integer, jsonb) to authenticated;

-- Member search: active members whose display name contains the text or whose name or
-- handle has it as a whole word, most followed first. The matching ids come from the two
-- text indexes on `users` (075_text_candidates.sql) and are read here under RLS. Keyset on
-- (followers_count, id). p_filters: city_id, min_followers.
create function public.search_users_page(
  p_query text,
  p_cursor jsonb default null,
  p_limit integer default 20,
  p_filters jsonb default '{}'::jsonb
)
returns table (
  id uuid,
  share_handle text,
  display_name text,
  avatar_url text,
  city_id text,
  privacy_mode text,
  verification_level smallint,
  followers_count integer,
  viewer_follows boolean,
  next_cursor jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  select u.id, u.share_handle, u.display_name, u.avatar_url, u.city_id, u.privacy_mode,
         u.verification_level, s.followers_count,
         exists (select 1 from public.follows f
                  where f.follower_id = (select auth.uid()) and f.followed_id = u.id),
         jsonb_build_object('n', s.followers_count, 'id', u.id)
    from public.users u
    join public.user_stats s on s.user_id = u.id
   where char_length(btrim(p_query)) >= 2
     and u.id = any (kc_access.user_ids_matching_text(btrim(p_query)))
     and (p_filters ->> 'city_id' is null or u.city_id = p_filters ->> 'city_id')
     and s.followers_count >= coalesce((p_filters ->> 'min_followers')::integer, 0)
     and (p_cursor is null
          or (s.followers_count, u.id) < ((p_cursor ->> 'n')::integer, (p_cursor ->> 'id')::uuid))
   order by s.followers_count desc, u.id desc
   limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;
comment on function public.search_users_page(text, jsonb, integer, jsonb) is
  'One keyset page of active members matching a text, most followed first.';
grant execute on function public.search_users_page(text, jsonb, integer, jsonb) to authenticated;

-- The search screen's first paint: the top posts and the top members for a text in one
-- call (FR-FEED-016 AC2, AC3). Each section is expanded with its own paged function.
create function public.search_all(p_query text, p_limit integer default 5)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'posts', (select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb)
                from public.search_posts_page(p_query, null, least(coalesce(p_limit, 5), 10)) p),
    'users', (select coalesce(jsonb_agg(to_jsonb(u)), '[]'::jsonb)
                from public.search_users_page(p_query, null, least(coalesce(p_limit, 5), 10)) u));
$$;
comment on function public.search_all(text, integer) is
  'Search preview: the first posts and the first members matching a text.';
grant execute on function public.search_all(text, integer) to authenticated;
