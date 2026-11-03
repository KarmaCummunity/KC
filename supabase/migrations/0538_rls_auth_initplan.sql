-- 0538_rls_auth_initplan | Wrap hot-table auth calls as initplans.
-- Policy semantics are unchanged; auth.uid() is evaluated once per query.
begin;

drop policy if exists posts_select_visible on public.posts;
create policy posts_select_visible on public.posts
  for select using (public.is_post_visible_to(posts.*, (select auth.uid())));

drop policy if exists posts_insert_self on public.posts;
create policy posts_insert_self on public.posts
  for insert with check (
    (select auth.uid()) = owner_id
    and public.is_active_member((select auth.uid()))
    and (
      visibility <> 'FollowersOnly'
      or exists (
        select 1 from public.users u
        where u.user_id = (select auth.uid()) and u.privacy_mode = 'Private'
      )
    )
  );

drop policy if exists posts_update_self on public.posts;
create policy posts_update_self on public.posts
  for update using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists chats_select_visible on public.chats;
create policy chats_select_visible on public.chats
  for select using (public.is_chat_visible_to(chats.*, (select auth.uid())));

drop policy if exists chats_insert_self on public.chats;
create policy chats_insert_self on public.chats
  for insert with check (
    (select auth.uid()) in (participant_a, participant_b)
    and public.is_active_member((select auth.uid()))
  );

drop policy if exists messages_insert_user on public.messages;
create policy messages_insert_user on public.messages
  for insert to authenticated
  with check (
    (select auth.uid()) = sender_id
    and kind = 'user'
    and system_payload is null
    and status = 'pending'
    and exists (
      select 1 from public.chats c
      where c.chat_id = messages.chat_id
        and c.removed_at is null
        and ((select auth.uid()) = c.participant_a or (select auth.uid()) = c.participant_b)
        and not public.has_blocked(
          case when (select auth.uid()) = c.participant_a then c.participant_b else c.participant_a end,
          (select auth.uid())
        )
        and (public.is_active_member((select auth.uid()))
             or (c.is_support_thread and public.can_contact_support((select auth.uid()))))
    )
  );

drop policy if exists messages_update_status_recipient on public.messages;
create policy messages_update_status_recipient on public.messages
  for update to authenticated
  using (exists (
    select 1 from public.chats c
    where c.chat_id = messages.chat_id
      and ((select auth.uid()) = c.participant_a or (select auth.uid()) = c.participant_b)
  ))
  with check (exists (
    select 1 from public.chats c
    where c.chat_id = messages.chat_id
      and ((select auth.uid()) = c.participant_a or (select auth.uid()) = c.participant_b)
  ));

drop policy if exists listings_select_visible on public.listings;
create policy listings_select_visible on public.listings
  for select using (public.is_listing_visible_to(listings.*, (select auth.uid())));

drop policy if exists listings_insert_own on public.listings;
create policy listings_insert_own on public.listings
  for insert to authenticated
  with check (owner_id = (select auth.uid()) and public.is_active_member((select auth.uid())));

drop policy if exists listings_update_own on public.listings;
create policy listings_update_own on public.listings
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists users_select_active on public.users;
create policy users_select_active on public.users
  for select using (
    account_status = 'active'
    and not public.is_blocked((select auth.uid()), user_id)
  );

drop policy if exists users_select_self on public.users;
create policy users_select_self on public.users
  for select using ((select auth.uid()) = user_id);

drop policy if exists users_update_self on public.users;
create policy users_update_self on public.users
  for update using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists follow_edges_insert_self on public.follow_edges;
create policy follow_edges_insert_self on public.follow_edges
  for insert with check ((select auth.uid()) = follower_id);

drop policy if exists follow_edges_delete_participants on public.follow_edges;
create policy follow_edges_delete_participants on public.follow_edges
  for delete using ((select auth.uid()) in (follower_id, followed_id));

drop policy if exists saved_posts_select_self on public.saved_posts;
create policy saved_posts_select_self on public.saved_posts
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists saved_posts_insert_self_visible on public.saved_posts;
create policy saved_posts_insert_self_visible on public.saved_posts
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.posts p
      where p.post_id = saved_posts.post_id
        and public.is_post_visible_to(p.*, (select auth.uid()))
    )
  );

drop policy if exists saved_posts_delete_self on public.saved_posts;
create policy saved_posts_delete_self on public.saved_posts
  for delete to authenticated using ((select auth.uid()) = user_id);

commit;
