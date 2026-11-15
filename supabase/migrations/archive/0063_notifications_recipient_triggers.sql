-- 0063_notifications_recipient_triggers | P1.5 PR-2 — FR-NOTIF-009/010.
-- Triggers on public.recipients (INSERT / DELETE).
--   INSERT → notify the recipient they were marked (FR-NOTIF-009).
--   DELETE where deleter = recipient → notify the owner the mark was removed (FR-NOTIF-010).
--   DELETE where deleter = owner (reopen) → no notification (FR-NOTIF-013 AC1).
--
-- Schema notes vs. plan draft:
--   - posts.owner_id  (not owner_user_id)
--   - recipients table holds recipient_user_id (there is no recipient_user_id column on posts)
--   - posts.status enum: removed_admin (not removed_auto)

begin;

create or replace function public.recipients_enqueue_notifications()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner_id       uuid;
  v_post_title     text;
  v_owner_name     text;
  v_recipient_name text;
  v_actor          uuid := auth.uid();
begin

  -- ── FR-NOTIF-009: recipient row inserted → notify the recipient ──────────
  if TG_OP = 'INSERT' then
    select p.owner_id, coalesce(p.title, '')
      into v_owner_id, v_post_title
      from public.posts p
     where p.post_id = NEW.post_id;

    select coalesce(u.display_name, 'Karma user')
      into v_owner_name
      from public.users u
     where u.user_id = v_owner_id;

    perform public.enqueue_notification(
      NEW.recipient_user_id,
      'critical',
      'mark_recipient',
      'notifications.markRecipientTitle',
      'notifications.markRecipientBody',
      jsonb_build_object(
        'ownerName',  coalesce(v_owner_name, 'Karma user'),
        'postTitle',  v_post_title
      ),
      jsonb_build_object(
        'route',  '/post/[id]',
        'params', jsonb_build_object('id', NEW.post_id::text)
      ),
      'mark:' || NEW.post_id::text || ':' || NEW.recipient_user_id::text,
      true   -- bypass_preferences per FR-NOTIF-009 AC3
    );

    return NEW;
  end if;

  -- ── FR-NOTIF-010: recipient row deleted by the recipient themselves ────────
  -- If the deleter is the recipient, notify the owner.
  -- If the deleter is the owner (reopen_post_marked), no notification (FR-NOTIF-013).
  if TG_OP = 'DELETE' and v_actor = OLD.recipient_user_id then
    select p.owner_id, coalesce(p.title, '')
      into v_owner_id, v_post_title
      from public.posts p
     where p.post_id = OLD.post_id;

    select coalesce(u.display_name, 'Karma user')
      into v_recipient_name
      from public.users u
     where u.user_id = OLD.recipient_user_id;

    perform public.enqueue_notification(
      v_owner_id,
      'critical',
      'unmark_recipient',
      'notifications.unmarkRecipientTitle',
      'notifications.unmarkRecipientBody',
      jsonb_build_object(
        'recipientName', coalesce(v_recipient_name, 'Karma user'),
        'postTitle',     v_post_title
      ),
      jsonb_build_object(
        'route',  '/post/[id]',
        'params', jsonb_build_object('id', OLD.post_id::text)
      ),
      'unmark:' || OLD.post_id::text,
      false
    );
  end if;

  return OLD;
end $$;

drop trigger if exists tg_recipients_enqueue_notifications on public.recipients;
create trigger tg_recipients_enqueue_notifications
  after insert or delete on public.recipients
  for each row
  execute function public.recipients_enqueue_notifications();

commit;
