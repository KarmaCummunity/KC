-- 0593_rls_auth_initplan | Wrap auth.uid() in the hot-table policies as an initplan.
-- Policy semantics are unchanged; auth.uid() is evaluated once per query, not once per row.
-- Generated from the live policy definitions (ALTER POLICY keeps roles and command), so it
-- never reverts later changes to these policies.
begin;

create or replace function public.post_has_recipients(p_post_id uuid)
returns boolean
language sql
stable security definer
set search_path = public
as $$
  select exists (select 1 from public.recipients where post_id = p_post_id);
$$;

grant execute on function public.post_has_recipients(uuid) to authenticated, anon;

alter policy posts_select_visible on public.posts
  using (is_post_visible_to(posts.*, (select auth.uid())));

alter policy posts_insert_self on public.posts
  with check ((((select auth.uid()) = owner_id) AND is_active_member((select auth.uid())) AND ((visibility <> 'FollowersOnly'::text) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.user_id = (select auth.uid())) AND (u.privacy_mode = 'Private'::text)))))));

alter policy posts_update_self on public.posts
  using (((select auth.uid()) = owner_id))
  with check (((select auth.uid()) = owner_id));

alter policy posts_delete_self_unlinked on public.posts
  using (
    (((select auth.uid()) = owner_id)
    and (
      status = 'open'
      or (
        not public.post_has_recipients(posts.post_id)
        and status in ('deleted_no_recipient', 'closed_delivered')
      )
    ))
  );

alter policy chats_select_visible on public.chats
  using (is_chat_visible_to(chats.*, (select auth.uid())));

alter policy messages_update_status_recipient on public.messages
  using ((EXISTS ( SELECT 1
   FROM chats c
  WHERE ((c.chat_id = messages.chat_id) AND (((select auth.uid()) = c.participant_a) OR ((select auth.uid()) = c.participant_b))))))
  with check ((EXISTS ( SELECT 1
   FROM chats c
  WHERE ((c.chat_id = messages.chat_id) AND (((select auth.uid()) = c.participant_a) OR ((select auth.uid()) = c.participant_b))))));

alter policy listings_select_visible on public.listings
  using (is_listing_visible_to(listings.*, (select auth.uid())));

alter policy listings_insert_own on public.listings
  with check (((owner_id = (select auth.uid())) AND is_active_member((select auth.uid()))));

alter policy listings_update_own on public.listings
  using ((owner_id = (select auth.uid())))
  with check ((owner_id = (select auth.uid())));

alter policy users_select_active on public.users
  using (((account_status = 'active'::text) AND (NOT is_blocked((select auth.uid()), user_id))));

alter policy users_select_self on public.users
  using (((select auth.uid()) = user_id));

alter policy users_update_self on public.users
  using (((select auth.uid()) = user_id))
  with check (((select auth.uid()) = user_id));

alter policy follow_edges_insert_self on public.follow_edges
  with check ((((select auth.uid()) = follower_id) AND (NOT is_private_profile(followed_id))));

alter policy follow_edges_delete_participants on public.follow_edges
  using ((((select auth.uid()) = follower_id) OR ((select auth.uid()) = followed_id)));

alter policy saved_posts_select_self on public.saved_posts
  using (((select auth.uid()) = user_id));

alter policy saved_posts_insert_self_visible on public.saved_posts
  with check ((((select auth.uid()) = user_id) AND (EXISTS ( SELECT 1
   FROM posts p
  WHERE ((p.post_id = saved_posts.post_id) AND is_post_visible_to(p.*, (select auth.uid())))))));

alter policy saved_posts_delete_self on public.saved_posts
  using (((select auth.uid()) = user_id));

commit;
