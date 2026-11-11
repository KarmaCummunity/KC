-- Posts · profile counters
--
-- user_stats holds, per member, the number of open posts in each audience and the number of
-- posts ever published. A viewer is shown the sum of the audiences they may see
-- (FR-PROFILE-013), so the three open counters are kept apart.

-- Applies the effect of one post write to its owner's counters, in the same transaction.
-- A post counts as open only in status `open`; it counts as created the moment it is first
-- published, and stays counted when it is later closed or deleted. Definer rights: counters
-- are not writable by members. When the owner's account is being removed the counter row
-- is already gone and the update matches nothing.
create function kc_private.posts_sync_user_stats()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Audience the post was counted under before / is counted under after; null = not open.
  v_old constant text := case when tg_op <> 'INSERT' and old.status = 'open' then old.visibility end;
  v_new constant text := case when tg_op <> 'DELETE' and new.status = 'open' then new.visibility end;
  v_published constant integer := case
    when tg_op = 'INSERT' and new.published_at is not null then 1
    when tg_op = 'UPDATE' and old.published_at is null and new.published_at is not null then 1
    else 0 end;
  v_owner_id constant uuid := case tg_op when 'DELETE' then old.owner_id else new.owner_id end;
begin
  if v_old is not distinct from v_new and v_published = 0 then
    return null;
  end if;

  update public.user_stats s
     set open_posts_public = greatest(s.open_posts_public
           + (v_new is not distinct from 'Public')::integer - (v_old is not distinct from 'Public')::integer, 0),
         open_posts_followers_only = greatest(s.open_posts_followers_only
           + (v_new is not distinct from 'FollowersOnly')::integer
           - (v_old is not distinct from 'FollowersOnly')::integer, 0),
         open_posts_only_me = greatest(s.open_posts_only_me
           + (v_new is not distinct from 'OnlyMe')::integer - (v_old is not distinct from 'OnlyMe')::integer, 0),
         posts_created_total = s.posts_created_total + v_published
   where s.user_id = v_owner_id;
  return null;
end;
$$;
comment on function kc_private.posts_sync_user_stats() is
  'AFTER trigger on posts: keeps the owner''s open-post and created-post counters in step.';

create trigger posts_sync_user_stats
  after insert or delete or update of status, visibility on public.posts
  for each row execute function kc_private.posts_sync_user_stats();
