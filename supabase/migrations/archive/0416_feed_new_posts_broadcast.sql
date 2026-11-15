-- 0416_feed_new_posts_broadcast | FR-FEED-009 "N new posts" banner via Broadcast.
--
-- posts is not in the supabase_realtime publication (by design, KC#878), so the client's
-- postgres_changes subscription never fired. Publish ids only on a private `feed:public`
-- topic; the client refetches through the normal RLS-gated feed when the user taps.

begin;

create or replace function public.posts_feed_new_post_broadcast()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.visibility = 'Public' and new.status = 'open' then
    begin
      perform realtime.send(
        jsonb_build_object('post_id', new.post_id, 'owner_id', new.owner_id),
        'new_post',
        'feed:public',
        true
      );
    exception when others then
      -- Never block a publish on realtime fan-out.
      null;
    end;
  end if;
  return null;
end;
$$;

revoke all on function public.posts_feed_new_post_broadcast() from public, anon, authenticated;

drop trigger if exists tg_posts_feed_new_post_broadcast on public.posts;
create trigger tg_posts_feed_new_post_broadcast
  after insert on public.posts
  for each row execute function public.posts_feed_new_post_broadcast();

drop policy if exists feed_public_broadcast_receive on realtime.messages;
create policy feed_public_broadcast_receive
  on realtime.messages
  for select
  to authenticated
  using (
    (select realtime.topic()) = 'feed:public'
    and realtime.messages.extension = 'broadcast'
  );

comment on policy feed_public_broadcast_receive on realtime.messages is
  'FR-FEED-009: feed:public new_post pings (post_id, owner_id only; Public + open posts).';

commit;
