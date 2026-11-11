-- 0646 | Feed settings: filter_kind = world must match posts.listing_world_slug, not post.category.

begin;

create or replace function public.post_muted_by_feed_filters(p_user_id uuid, p_post public.posts)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null and exists (
    select 1
      from public.feed_mute_filters mf
     where mf.user_id = p_user_id
       and (
         (mf.filter_kind = 'user' and mf.filter_value = p_post.owner_id::text)
         or (mf.filter_kind = 'category' and mf.filter_value = p_post.category)
         or (mf.filter_kind = 'world' and mf.filter_value = coalesce(p_post.listing_world_slug, 'items'))
         or (mf.filter_kind = 'keyword' and (
           p_post.title ilike '%' || public.escape_ilike(mf.filter_value) || '%' escape '\'
           or coalesce(p_post.description, '') ilike '%' || public.escape_ilike(mf.filter_value) || '%' escape '\'
         ))
       )
  );
$$;

comment on function public.post_muted_by_feed_filters(uuid, public.posts) is
  'True when p_user_id has a feed_mute_filters row that hides p_post (user, category, giving world, keyword).';

revoke all on function public.post_muted_by_feed_filters(uuid, public.posts) from public, anon;
grant execute on function public.post_muted_by_feed_filters(uuid, public.posts) to authenticated;

create or replace view public.feed_visible_posts
with (security_invoker = true) as
select p.*
  from public.posts p
 where not p.feed_hidden
   and not exists (
         select 1
           from public.feed_post_hides h
          where h.user_id = (select auth.uid())
            and h.post_id = p.post_id
       )
   and not public.post_muted_by_feed_filters((select auth.uid()), p);

revoke all on public.feed_visible_posts from public, anon;
grant select on public.feed_visible_posts to authenticated;

commit;
