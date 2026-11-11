-- 0066_notifications_post_expiry_cron | P1.5 PR-2 — FR-NOTIF-005.
-- Daily cron at 06:00 UTC (09:00 IL) scans for posts hitting day 293
-- (7 days before the 300-day auto-expiry) and enqueues a Critical notification
-- to the owner.
--
-- Schema note vs. plan draft:
--   - posts.owner_id (not owner_user_id)

begin;

create or replace function public.notifications_post_expiry_check()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare r record;
begin
  for r in
    select post_id, owner_id, coalesce(title, '') as title
      from public.posts
     where status = 'open'
       and created_at + interval '293 days' <= now()
       and created_at + interval '294 days' >  now()
  loop
    perform public.enqueue_notification(
      r.owner_id,
      'critical',
      'post_expiring',
      'notifications.postExpiringTitle',
      'notifications.postExpiringBody',
      jsonb_build_object('postTitle', r.title),
      jsonb_build_object(
        'route',  '/post/[id]',
        'params', jsonb_build_object('id', r.post_id::text)
      ),
      'expire:' || r.post_id::text,
      false
    );
  end loop;
end $$;

-- Unschedule any previous registration before re-registering (idempotent).
select cron.unschedule('notifications_post_expiry_check')
  where exists (
    select 1 from cron.job where jobname = 'notifications_post_expiry_check'
  );

select cron.schedule(
  'notifications_post_expiry_check',
  '0 6 * * *',
  $$ select public.notifications_post_expiry_check(); $$
);

commit;
