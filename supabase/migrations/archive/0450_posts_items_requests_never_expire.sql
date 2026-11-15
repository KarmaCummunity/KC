-- 0450_posts_items_requests_never_expire | D21, D59 / G32, S3
-- docs/spec/07_cross_cutting_systems.md §7.1: "items and all requests — no
-- expiry; the owner gets relevance reminders instead". `posts` holds item
-- offers and requests only (food and rides live in `listings` / `ride_listings`
-- with their own date-based sweeps), so the legacy 300-day rule
-- (FR-POST-012/013, superseded) is replaced:
--   - removed: 0153 posts_expiry_daily (open → expired at created_at + 300 d)
--   - removed: 0066 notifications_post_expiry_check ("expires in 7 days")
--   - added:   posts_relevance_reminders_daily — S3: 14 days after publish,
--              then every 30 days, the owner is asked "still relevant?"
-- Posts that already expired stay `expired`; owners can reopen them as before.
-- The `post_expiring` kind stays so existing inbox rows still render.

begin;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobname)
       from cron.job
      where jobname in ('posts_expiry_daily', 'notifications_post_expiry_check');
  end if;
end $$;

drop function if exists public.posts_expiry_transition();
drop function if exists public.notifications_post_expiry_check();

-- Whole days since publish on which an open post gets a reminder (S3).
create or replace function public.post_relevance_reminder_due(p_age_days integer)
returns boolean
language sql
immutable
as $$
  select p_age_days >= 14 and (p_age_days - 14) % 30 = 0;
$$;

create or replace function public.notifications_post_relevance_check()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_sent integer := 0;
begin
  for r in
    select post_id, owner_id, coalesce(title, '') as title,
           (current_date - created_at::date) as age_days
      from public.posts
     where status = 'open'
       and public.post_relevance_reminder_due(current_date - created_at::date)
  loop
    if public.enqueue_notification(
      r.owner_id,
      'critical',
      'post_relevance_check',
      'notifications.postRelevanceTitle',
      'notifications.postRelevanceBody',
      jsonb_build_object('postTitle', r.title),
      jsonb_build_object('route', '/post/[id]', 'params', jsonb_build_object('id', r.post_id::text)),
      'relevance:' || r.post_id::text || ':' || r.age_days::text,
      false
    ) is not null then
      v_sent := v_sent + 1;
    end if;
  end loop;
  return v_sent;
end $$;

-- Cron and SQL editor only.
revoke execute on function public.notifications_post_relevance_check() from public, authenticated, anon;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'posts_relevance_reminders_daily') then
      perform cron.unschedule('posts_relevance_reminders_daily');
    end if;
    -- 06:00 UTC = 09:00 Israel, the slot the old expiry warning used.
    perform cron.schedule('posts_relevance_reminders_daily', '0 6 * * *',
      $sql$ select public.notifications_post_relevance_check(); $sql$);
  else
    raise notice 'pg_cron not enabled — posts_relevance_reminders_daily not scheduled.';
  end if;
end $$;

commit;
