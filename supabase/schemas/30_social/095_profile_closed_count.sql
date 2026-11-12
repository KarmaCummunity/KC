-- Social · closed-post count of a profile (FR-PROFILE-001, M13)
--
-- The badge of the "closed" tab. It is a count over the same rows the tab lists, not a
-- stored counter: what a viewer may count depends on who is looking (RLS narrows the rows,
-- the owner also counts their own deleted-without-recipient posts), which a column of
-- `user_stats` cannot express, and a count needs no trigger on the hot path of closing a
-- post. The scan is one member's posts through posts_owner_recent_idx, bounded by how many
-- posts a single member has.

-- Number of posts in the "closed" tab of a member, as the caller may see them: the same
-- filter as profile_posts_page(p_tab => 'closed').
create function public.profile_closed_posts_count(p_user_id uuid)
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*)::integer
    from public.posts p
   where p.owner_id = p_user_id
     and p.status in ('closed_delivered', 'deleted_no_recipient')
     and p.visibility <> 'OnlyMe';
$$;
comment on function public.profile_closed_posts_count(uuid) is
  'Size of the closed tab of a profile for the caller; same rows as profile_posts_page(closed).';
grant execute on function public.profile_closed_posts_count(uuid) to authenticated;
