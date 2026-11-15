-- 0093_follow_request_dedupe_cycle | TD-78 (BACKLOG P2.13)
--
-- Audit 2026-05-16 finding: follow_request / follow_approved dedupe keys
-- lack a cycle segment. The unique partial index on
-- notifications_outbox.dedupe_key is permanent (the outbox has a 7-day
-- expires_at but no row-prune cron, and the dedupe index covers all rows).
-- Old key format: 'follow_req:<requester>:<target>' / 'follow_appr:...'
-- After a 14-day cooldown (FR-FOLLOW-008) the requester opens a new cycle
-- by INSERTing a fresh follow_requests row, but the legacy outbox row
-- with the same key still occupies the unique index → enqueue_notification
-- ON CONFLICT DO NOTHING silently drops both the follow_request and the
-- follow_approved notification.
--
-- Fix: append NEW.id (the follow_requests row UUID) to the dedupe key.
-- Each new follow_requests row gets a unique key so re-request cycles
-- emit fresh notifications. Within a single row, INSERT fires once
-- (the dedupe key still prevents accidental duplicate-trigger), and the
-- pending→accepted UPDATE fires once with the same NEW.id but a
-- different prefix ('follow_appr:'), so the two notifications stay
-- distinct.
--
-- No backfill needed — old outbox rows are unaffected. New cycles emit
-- new keys; the inability to reuse a 7-day-expired row's key was the bug.

begin;

create or replace function public.follow_requests_enqueue_notifications()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_requester_name text;
  v_target_name    text;
begin
  -- FR-NOTIF-006: new pending request → notify the target.
  if TG_OP = 'INSERT' and NEW.status = 'pending' then
    select coalesce(u.display_name, 'Karma user')
      into v_requester_name
      from public.users u
     where u.user_id = NEW.requester_id;

    perform public.enqueue_notification(
      NEW.target_id,
      'social',
      'follow_request',
      'notifications.followRequestTitle',
      'notifications.followRequestBody',
      jsonb_build_object('requesterName', coalesce(v_requester_name, 'Karma user')),
      jsonb_build_object('route', '/settings/follow-requests'),
      -- TD-78: include row.id so each new cycle (post-cooldown) gets a
      -- fresh dedupe key. Old format collided across cycles.
      'follow_req:' || NEW.requester_id::text || ':' || NEW.target_id::text || ':' || NEW.id::text,
      false
    );

  -- FR-NOTIF-008: request accepted → notify the requester.
  elsif TG_OP = 'UPDATE' and NEW.status = 'accepted' and OLD.status <> 'accepted' then
    select coalesce(u.display_name, 'Karma user')
      into v_target_name
      from public.users u
     where u.user_id = NEW.target_id;

    perform public.enqueue_notification(
      NEW.requester_id,
      'social',
      'follow_approved',
      'notifications.followApprovedTitle',
      'notifications.followApprovedBody',
      jsonb_build_object('targetName', coalesce(v_target_name, 'Karma user')),
      jsonb_build_object(
        'route',  '/user/[handle]',
        'params', jsonb_build_object('handle', NEW.target_id::text)
      ),
      -- TD-78: same fix as above — append row.id for cycle uniqueness.
      'follow_appr:' || NEW.requester_id::text || ':' || NEW.target_id::text || ':' || NEW.id::text,
      false
    );
  end if;

  return NEW;
end $$;

-- Trigger binding is unchanged; just replacing the function body.

commit;
