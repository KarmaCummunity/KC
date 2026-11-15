-- Realtime of the member screens: live counters, the feed's new-posts pill and online presence
-- (FR-KARMA-009, FR-FEED-009 AC2, FR-SETTINGS "show my active status"; ADR-003)
--
-- Three topics the app listened to before the baseline cut-over, restored on the baseline's
-- realtime wiring (40_messaging/060_realtime.sql):
--
--   user:<user_id>:stats   event `stats_changed`: the member's own profile counters (karma,
--                          followers, following, given, received, open posts) changed. The
--                          payload carries the new counters; only their owner may listen, through
--                          the existing policy on a member's own `user:<id>:…` topics.
--   feed:public            event `new_post`: a post became open and Public. The payload is a
--                          ping (post id and owner id); the app re-reads the feed through RLS.
--   presence:online        Presence, key = the member's id: who is online now. Tracking and
--                          receiving both require an active account whose "show my active
--                          status" is on (reciprocal, as in messengers). The same rule now holds
--                          for presence inside a chat (`chat:<id>:presence`).

-- Policy helper: true when the member holds an active account and shows their active status.
-- False for an unknown member, so a policy fails closed.
create function kc_access.shows_active_status(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select u.is_active and p.show_active_status
      from public.users u
      join public.user_private p on p.user_id = u.id
     where u.id = p_user_id), false);
$$;
comment on function kc_access.shows_active_status(uuid) is
  'Policy helper: the member is active and shows their active status (online presence).';
grant execute on function kc_access.shows_active_status(uuid) to authenticated;

-- The member's own counters, sent to their own topic when one of them changes. The nightly
-- reconciliation rewrites a row only when it finds drift, so it sends only then.
create function kc_private.user_stats_broadcast()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform kc_private.broadcast('user:' || new.user_id || ':stats', 'stats_changed', jsonb_build_object(
    'karma_points', new.karma_points,
    'followers_count', new.followers_count,
    'following_count', new.following_count,
    'items_given_count', new.items_given_count,
    'items_received_count', new.items_received_count,
    'posts_created_total', new.posts_created_total,
    'open_posts_count', new.open_posts_public + new.open_posts_followers_only + new.open_posts_only_me));
  return null;
end;
$$;
comment on function kc_private.user_stats_broadcast() is
  'AFTER UPDATE on user_stats: sends the member''s new counters to their own stats topic.';

create trigger user_stats_broadcast
  after update on public.user_stats
  for each row
  when ((old.karma_points, old.followers_count, old.following_count, old.items_given_count,
         old.items_received_count, old.posts_created_total, old.open_posts_public,
         old.open_posts_followers_only, old.open_posts_only_me)
        is distinct from
        (new.karma_points, new.followers_count, new.following_count, new.items_given_count,
         new.items_received_count, new.posts_created_total, new.open_posts_public,
         new.open_posts_followers_only, new.open_posts_only_me))
  execute function kc_private.user_stats_broadcast();

-- A ping on the public feed topic when a post first becomes open and Public: on insert as
-- open, on publishing a draft, or when an open post's audience widens to Public.
create function kc_private.posts_feed_new_post_broadcast()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'open' and new.visibility = 'Public'
     and (tg_op = 'INSERT' or old.status is distinct from 'open' or old.visibility is distinct from 'Public') then
    perform kc_private.broadcast('feed:public', 'new_post',
      jsonb_build_object('post_id', new.id, 'owner_id', new.owner_id));
  end if;
  return null;
end;
$$;
comment on function kc_private.posts_feed_new_post_broadcast() is
  'AFTER INSERT / UPDATE on posts: pings feed:public when a post becomes open and Public.';

create trigger posts_feed_new_post_broadcast
  after insert or update of status, visibility on public.posts
  for each row execute function kc_private.posts_feed_new_post_broadcast();

-- Who may listen and track. The policies exist only where the platform table does.
do $$
begin
  if to_regclass('realtime.messages') is null then
    return;
  end if;

  -- The feed ping carries ids of Public posts only; any signed-in member may hear it.
  execute $policy$
    create policy kc_feed_public_receive on realtime.messages
      for select to authenticated
      using ((select realtime.topic()) = 'feed:public' and realtime.messages.extension = 'broadcast')
  $policy$;

  -- Online presence, both directions gated by the member's own "show my active status".
  execute $policy$
    create policy kc_online_presence_receive on realtime.messages
      for select to authenticated
      using ((select realtime.topic()) = 'presence:online'
             and realtime.messages.extension = 'presence'
             and kc_access.shows_active_status((select auth.uid())))
  $policy$;
  execute $policy$
    create policy kc_online_presence_track on realtime.messages
      for insert to authenticated
      with check ((select realtime.topic()) = 'presence:online'
                  and realtime.messages.extension = 'presence'
                  and kc_access.shows_active_status((select auth.uid())))
  $policy$;

  -- Presence inside a chat follows the same setting; typing is unaffected.
  execute 'drop policy kc_chat_topics_send on realtime.messages';
  execute $policy$
    create policy kc_chat_topics_send on realtime.messages
      for insert to authenticated
      with check (((select realtime.topic()) like 'chat:%:typing'
                   or ((select realtime.topic()) like 'chat:%:presence'
                       and kc_access.shows_active_status((select auth.uid()))))
                  and kc_access.can_access_chat(kc_access.realtime_topic_uuid((select realtime.topic()))))
  $policy$;
end $$;
