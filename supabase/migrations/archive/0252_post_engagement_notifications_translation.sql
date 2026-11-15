-- 0252_post_engagement_notifications_translation | KC#867 — outbox + translation hooks.

-- ── content_translations: post_comment ───────────────────────────────────────

alter table public.content_translations drop constraint if exists content_translations_type_chk;
alter table public.content_translations
  add constraint content_translations_type_chk
  check (content_type in ('post', 'message', 'ride_listing', 'user', 'post_comment'));

create or replace function public.content_translations_purge_post_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.content_translations
   where content_type = 'post_comment' and content_id = old.comment_id;
  return old;
end;
$$;

drop trigger if exists trg_content_translations_purge_post_comment on public.post_comments;
create trigger trg_content_translations_purge_post_comment
  before delete on public.post_comments
  for each row execute function public.content_translations_purge_post_comment();

create or replace function public.content_translations_purge_post_comment_edit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.body is distinct from old.body then
    delete from public.content_translations
     where content_type = 'post_comment' and content_id = new.comment_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_content_translations_purge_post_comment_edit on public.post_comments;
create trigger trg_content_translations_purge_post_comment_edit
  after update of body on public.post_comments
  for each row execute function public.content_translations_purge_post_comment_edit();

-- ── Notifications (reaction / comment / mention) ─────────────────────────────

create or replace function public.post_engagement_enqueue_notifications()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner_id   uuid;
  v_actor_name text;
  v_post_id    uuid;
  v_uid        uuid;
  v_mention    uuid;
begin
  if tg_table_name = 'post_reactions' and tg_op = 'INSERT' then
    select p.owner_id, new.post_id into v_owner_id, v_post_id
      from public.posts p where p.post_id = new.post_id;

    select coalesce(u.display_name, 'Karma user') into v_actor_name
      from public.users u where u.user_id = new.user_id;

    perform public.enqueue_notification(
      v_owner_id,
      'social',
      'post_reaction',
      'notifications.postReactionTitle',
      'notifications.postReactionBody',
      jsonb_build_object('actorName', v_actor_name, 'reactionType', new.reaction_type),
      jsonb_build_object('route', '/post/[id]', 'params', jsonb_build_object('id', v_post_id::text)),
      'post_react:' || new.post_id::text || ':' || new.user_id::text,
      false
    );

  elsif tg_table_name = 'post_comments' and tg_op = 'INSERT' and new.status = 'active' then
    select p.owner_id into v_owner_id from public.posts p where p.post_id = new.post_id;

    select coalesce(u.display_name, 'Karma user') into v_actor_name
      from public.users u where u.user_id = new.author_id;

    if v_owner_id is not null and v_owner_id <> new.author_id then
      perform public.enqueue_notification(
        v_owner_id,
        'social',
        'post_comment',
        'notifications.postCommentTitle',
        'notifications.postCommentBody',
        jsonb_build_object('actorName', v_actor_name),
        jsonb_build_object('route', '/post/[id]', 'params', jsonb_build_object('id', new.post_id::text)),
        'post_cmt_owner:' || new.comment_id::text,
        false
      );
    end if;

    if new.mention_user_ids is not null then
      foreach v_mention in array new.mention_user_ids loop
        if v_mention is not null and v_mention <> new.author_id then
          perform public.enqueue_notification(
            v_mention,
            'social',
            'post_mention',
            'notifications.postMentionTitle',
            'notifications.postMentionBody',
            jsonb_build_object('actorName', v_actor_name),
            jsonb_build_object('route', '/post/[id]', 'params', jsonb_build_object('id', new.post_id::text)),
            'post_mention:' || new.comment_id::text || ':' || v_mention::text,
            false
          );
        end if;
      end loop;
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists tg_post_reactions_enqueue on public.post_reactions;
create trigger tg_post_reactions_enqueue
  after insert on public.post_reactions
  for each row execute function public.post_engagement_enqueue_notifications();

drop trigger if exists tg_post_comments_enqueue on public.post_comments;
create trigger tg_post_comments_enqueue
  after insert on public.post_comments
  for each row execute function public.post_engagement_enqueue_notifications();
