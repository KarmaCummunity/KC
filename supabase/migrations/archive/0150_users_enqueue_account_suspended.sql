-- 0135 — P2.13 MOD-1 (TD-76) — Critical notification on account suspension.
--
-- Audit finding: auto-removal of a `target_type='user'` flips
-- `users.account_status='suspended_admin'`, but `posts_enqueue_auto_removed`
-- only listens to `posts.status` transitions, so no push fires. Spec
-- (FR-NOTIF-011 user target) mandates a Critical notification for every
-- target type. Today the user is silently locked out at sign-in — they appeal
-- into a void.
--
-- This trigger fires on every transition of `users.account_status` to
-- `suspended_admin` or `banned` (covers auto-threshold removals AND admin
-- manual actions). It enqueues a Critical notification with
-- `bypass_preferences: true` so users who disabled Critical still receive it.
--
-- Dedupe key includes the new status to allow a re-notification on a
-- restore-then-re-suspend sequence (FR-MOD-005 behavior, audit MOD-22).
--
-- Mapped to spec: FR-NOTIF-011 (auto_removed user target).

begin;

create or replace function public.users_enqueue_account_suspended()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Only fire on transitions INTO a moderation-terminal state.
  if NEW.account_status not in ('suspended_admin', 'banned') then
    return NEW;
  end if;
  if OLD.account_status = NEW.account_status then
    return NEW;
  end if;

  perform public.enqueue_notification(
    NEW.user_id,
    'critical',
    'account_suspended',
    'notifications.accountSuspendedTitle',
    'notifications.accountSuspendedBody',
    jsonb_build_object('status', NEW.account_status),
    jsonb_build_object('route', '/account-blocked'),
    'account_suspended:' || NEW.user_id::text || ':' || NEW.account_status,
    true   -- bypass_preferences: this is the highest-impact account event
  );

  return NEW;
end $$;

drop trigger if exists tg_users_enqueue_account_suspended on public.users;
create trigger tg_users_enqueue_account_suspended
  after update of account_status on public.users
  for each row
  execute function public.users_enqueue_account_suspended();

commit;
