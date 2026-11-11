-- 0146_post_expiry_cron | TD-70 — FR-POST-013 AC1
-- Daily cron at 06:30 UTC that transitions posts.status='open' → 'expired'
-- when the post has been around for 300 days (created_at + 300d <= now()).
--
-- Why this exists:
--   Migration 0066 only fires a day-293 notification. Nothing ever flipped
--   the status, so posts older than 300 days kept counting toward the 20-post
--   cap (FR-POST-011) and the personal_activity_log trigger on
--   `new.status = 'expired'` (0044) was dead.
--
-- Cascade behaviour (already wired by earlier migrations):
--   - 0018 posts_after_change_counters: decrements active_posts_count_*
--   - 0044 posts_personal_activity_after_status_change: emits 'post_expired'
--   - 0002 set_updated_at: refreshes posts.updated_at
--   - 0002 is_post_visible_to: 'expired' is owner-only thereafter
--   - 0002 posts_active_cap_on_status_change: not invoked (we leave 'open')
--
-- Clock semantics: matches 0066 (created_at-based, not last-opened). A post
-- reopened after closure expires at created_at + 300d, same as the notify cron.
--
-- Requires pg_cron enabled (same operator note as 0016/0045/0066/0076).

begin;

-- ── 1. Expiry function ──────────────────────────────────────────────────────
create or replace function public.posts_expiry_transition()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_transitioned integer;
begin
  with expired as (
    update public.posts
       set status = 'expired'
     where status = 'open'
       and created_at + interval '300 days' <= now()
    returning post_id
  )
  select count(*) into v_transitioned from expired;

  return coalesce(v_transitioned, 0);
end $$;

-- Not callable by authenticated/anon — cron and SQL-editor only.
revoke execute on function public.posts_expiry_transition()
  from public, authenticated, anon;

-- ── 2. Daily cron ───────────────────────────────────────────────────────────
-- 06:30 UTC — 30 min after notifications_post_expiry_check (0066) so the
-- day-293 notification has already gone out before any same-clock-day expiry.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'posts_expiry_daily') then
      perform cron.unschedule('posts_expiry_daily');
    end if;
    perform cron.schedule(
      'posts_expiry_daily',
      '30 6 * * *',
      $sql$ select public.posts_expiry_transition(); $sql$
    );
  else
    raise notice
      'pg_cron not enabled — posts_expiry_daily not scheduled. Enable pg_cron in Supabase dashboard, then re-run.';
  end if;
end $$;

commit;

-- end of 0097_post_expiry_cron
