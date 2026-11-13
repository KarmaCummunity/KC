-- 0105_fix_follow_request_dedupe_key | TD-78 hotfix.
--
-- Migration 0093 attempted to append `NEW.id` to the follow_request and
-- follow_approved dedupe keys, but public.follow_requests has a composite
-- primary key (requester_id, target_id, created_at) and no `id` column.
-- Every INSERT with status='pending' therefore raised:
--   record "new" has no field "id"
-- breaking FR-FOLLOW request creation entirely as soon as 0093 was applied.
-- Caught by the sqlProbes integration test the moment ci-backend.yml could
-- actually run it (Node 22 bump unblocked the runner).
--
-- Fix: append NEW.created_at instead. created_at is part of the PK, unique
-- per row, and preserves the original "fresh cycle = fresh key" property —
-- a post-cooldown re-request creates a row with a different created_at,
-- hence a different dedupe key. INSERT and UPDATE on the same row share the
-- same created_at, but the 'follow_req:' vs 'follow_appr:' prefix already
-- keeps the two notifications distinct.
--
-- No backfill: old outbox rows are unaffected; the unique partial index on
-- dedupe_key only blocks future inserts that collide. New keys won't collide
-- with old ones because the appended timestamptz changes the suffix shape.

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
      'follow_req:' || NEW.requester_id::text || ':' || NEW.target_id::text || ':' || NEW.created_at::text,
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
      'follow_appr:' || NEW.requester_id::text || ':' || NEW.target_id::text || ':' || NEW.created_at::text,
      false
    );
  end if;

  return NEW;
end $$;

-- Trigger binding from 0065 is unchanged; only replacing the function body.

commit;
