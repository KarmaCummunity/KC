-- 0065_notifications_follow_triggers | P1.5 PR-2 — FR-NOTIF-006/007/008.
-- Three follow-related notification producers:
--   FR-NOTIF-006: INSERT on follow_requests (status='pending') → notify target
--   FR-NOTIF-008: UPDATE on follow_requests (status: pending→accepted) → notify requester
--   FR-NOTIF-007: INSERT on follow_edges → notify followee
--
-- Schema notes vs. plan draft:
--   - follow_requests uses requester_id / target_id (not requester_user_id / target_user_id)
--   - follow table is follow_edges with follower_id / followed_id (not follows / follower_user_id / followee_user_id)
--   - follow_edges has no 'source' column — trigger fires on every INSERT;
--     dispatcher's 60-min coalescing handles FR-NOTIF-007 AC3

begin;

-- ── FR-NOTIF-006 / FR-NOTIF-008: follow_requests ────────────────────────────

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
      'follow_req:' || NEW.requester_id::text || ':' || NEW.target_id::text,
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
      'follow_appr:' || NEW.requester_id::text || ':' || NEW.target_id::text,
      false
    );
  end if;

  return NEW;
end $$;

drop trigger if exists tg_follow_requests_enqueue on public.follow_requests;
create trigger tg_follow_requests_enqueue
  after insert or update on public.follow_requests
  for each row
  execute function public.follow_requests_enqueue_notifications();

-- ── FR-NOTIF-007: follow_edges INSERT → notify followee ─────────────────────

create or replace function public.follow_edges_enqueue_started()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_follower_name text;
begin
  select coalesce(u.display_name, 'Karma user')
    into v_follower_name
    from public.users u
   where u.user_id = NEW.follower_id;

  -- No dedupe_key: dispatcher's ≥3-in-60min coalescing handles FR-NOTIF-007 AC3.
  -- follow_edges has no 'source' column; trigger fires on every insert.
  -- For approved-request follows, follow_requests_enqueue already notified
  -- the requester (FR-NOTIF-008); here we notify the followee.
  perform public.enqueue_notification(
    NEW.followed_id,
    'social',
    'follow_started',
    'notifications.followStartedTitle',
    'notifications.followStartedBody',
    jsonb_build_object('followerName', coalesce(v_follower_name, 'Karma user')),
    jsonb_build_object(
      'route',  '/user/[handle]',
      'params', jsonb_build_object('handle', NEW.follower_id::text)
    ),
    null,
    false
  );

  return NEW;
end $$;

drop trigger if exists tg_follow_edges_enqueue_started on public.follow_edges;
create trigger tg_follow_edges_enqueue_started
  after insert on public.follow_edges
  for each row
  execute function public.follow_edges_enqueue_started();

commit;
