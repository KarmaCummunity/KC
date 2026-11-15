-- 0253_post_engagement_realtime_broadcast | KC#878 — Broadcast (not postgres_changes) for engagement.

-- Topic convention: post:<post_id>:engagement (private channel; see docs/SSOT/social_realtime_conventions.md)

create or replace function public.post_engagement_broadcast_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post_id uuid;
  v_topic   text;
begin
  v_post_id := coalesce(new.post_id, old.post_id);
  v_topic := 'post:' || v_post_id::text || ':engagement';

  perform realtime.broadcast_changes(
    v_topic,
    tg_op,
    tg_op,
    tg_table_name,
    tg_table_schema,
    new,
    old
  );
  return null;
end;
$$;

drop trigger if exists tg_post_reactions_broadcast on public.post_reactions;
create trigger tg_post_reactions_broadcast
  after insert or update or delete on public.post_reactions
  for each row execute function public.post_engagement_broadcast_changes();

drop trigger if exists tg_post_comments_broadcast on public.post_comments;
create trigger tg_post_comments_broadcast
  after insert or update or delete on public.post_comments
  for each row execute function public.post_engagement_broadcast_changes();

drop trigger if exists tg_post_shares_broadcast on public.post_shares;
create trigger tg_post_shares_broadcast
  after insert on public.post_shares
  for each row execute function public.post_engagement_broadcast_changes();

drop trigger if exists tg_post_stats_broadcast on public.post_stats;
create trigger tg_post_stats_broadcast
  after update on public.post_stats
  for each row execute function public.post_engagement_broadcast_changes();

-- Realtime Authorization: subscribers must pass is_post_visible_to for the post in the topic.
drop policy if exists post_engagement_broadcast_receive on realtime.messages;
create policy post_engagement_broadcast_receive
  on realtime.messages
  for select
  to authenticated
  using (
    (select realtime.topic()) like 'post:%:engagement'
    and exists (
      select 1
        from public.posts p
       where p.post_id = (
         nullif(split_part((select realtime.topic()), ':', 2), '')::uuid
       )
         and public.is_post_visible_to(p.*, (select auth.uid()))
    )
  );

comment on policy post_engagement_broadcast_receive on realtime.messages is
  'KC#878: private broadcast fan-out for post engagement; topic post:<uuid>:engagement.';
