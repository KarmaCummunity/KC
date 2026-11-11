-- 0064_notifications_auto_removed_trigger | P1.5 PR-2 — FR-NOTIF-011.
-- Trigger on public.posts UPDATE: when status transitions to 'removed_admin',
-- enqueues a Critical notification to the post owner.
--
-- Schema note vs. plan draft:
--   - posts.owner_id (not owner_user_id)
--   - status value is 'removed_admin' (not 'removed_auto')

begin;

create or replace function public.posts_enqueue_auto_removed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if NEW.status = 'removed_admin' and OLD.status <> 'removed_admin' then
    perform public.enqueue_notification(
      NEW.owner_id,
      'critical',
      'auto_removed',
      'notifications.autoRemovedTitle',
      'notifications.autoRemovedBody',
      '{}'::jsonb,
      jsonb_build_object('route', '/help/removed-post'),
      'auto_removed:' || NEW.post_id::text,
      false
    );
  end if;
  return NEW;
end $$;

drop trigger if exists tg_posts_enqueue_auto_removed on public.posts;
create trigger tg_posts_enqueue_auto_removed
  after update of status on public.posts
  for each row
  execute function public.posts_enqueue_auto_removed();

commit;
