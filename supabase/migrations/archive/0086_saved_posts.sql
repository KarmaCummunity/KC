-- 0086_saved_posts.sql | FR-POST-022, FR-PROFILE-016, D-29
-- Per-user bookmarks for posts the viewer can read at save time.

create table if not exists public.saved_posts (
  user_id   uuid not null references public.users(user_id) on delete cascade,
  post_id   uuid not null references public.posts(post_id) on delete cascade,
  saved_at  timestamptz not null default now(),
  primary key (user_id, post_id)
);

create index saved_posts_user_saved_at_idx
  on public.saved_posts (user_id, saved_at desc);

alter table public.saved_posts enable row level security;

create policy saved_posts_select_self on public.saved_posts
  for select to authenticated
  using (auth.uid() = user_id);

create policy saved_posts_insert_self_visible on public.saved_posts
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.posts p
      where p.post_id = saved_posts.post_id
        and public.is_post_visible_to(p.*, auth.uid())
    )
  );

create policy saved_posts_delete_self on public.saved_posts
  for delete to authenticated
  using (auth.uid() = user_id);

grant select, insert, delete on public.saved_posts to authenticated;
