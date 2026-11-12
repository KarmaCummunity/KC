-- Notifications · follow events (FR-NOTIF-006, FR-NOTIF-007, FR-NOTIF-008)
--
-- The social graph module writes the rows; these triggers record the `notification` events
-- that follow from them. Each event carries a dedupe key, so a member is told once:
--   follow_request   follow_request:<request id>            the target, per request
--   follow_approved  follow_approved:<request id>           the requester, per request
--   follow_started   follow_started:<follower>:<followed>   the followed member, once per
--                    pair for as long as the key is kept — following again after an
--                    unfollow does not notify a second time

-- A new follower. An edge created by the approval of a request is not announced to the
-- member who just approved it: the requester gets `follow_approved` instead.
create function kc_private.follows_enqueue_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The request was resolved in this transaction: its resolution time is this transaction's.
  if exists (select 1 from public.follow_requests r
              where r.requester_id = new.follower_id and r.target_id = new.followed_id
                and r.status = 'accepted' and r.resolved_at = now()) then
    return null;
  end if;
  perform kc_private.outbox_enqueue('notification', jsonb_build_object(
    'kind', 'follow_started', 'recipient_id', new.followed_id, 'actor_id', new.follower_id,
    -- The entity is the followed member, so new followers merge into one notification.
    'entity', jsonb_build_object('type', 'user', 'id', new.followed_id),
    'data', jsonb_build_object(
      'dedupe_key', 'follow_started:' || new.follower_id || ':' || new.followed_id)));
  return null;
end;
$$;
comment on function kc_private.follows_enqueue_notification() is
  'AFTER INSERT on follows: enqueues follow_started for the followed member.';

create trigger follows_enqueue_notification
  after insert on public.follows
  for each row execute function kc_private.follows_enqueue_notification();

-- A new request reaches its target; an accepted one reaches its requester. A rejection and
-- a withdrawal are silent (FR-FOLLOW-006).
create function kc_private.follow_requests_enqueue_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_accepted constant boolean := tg_op = 'UPDATE';
begin
  perform kc_private.outbox_enqueue('notification', jsonb_build_object(
    'kind', case when v_accepted then 'follow_approved' else 'follow_request' end,
    'recipient_id', case when v_accepted then new.requester_id else new.target_id end,
    'actor_id', case when v_accepted then new.target_id else new.requester_id end,
    'entity', jsonb_build_object('type', 'follow_request', 'id', new.id),
    'data', jsonb_build_object('dedupe_key',
      case when v_accepted then 'follow_approved:' else 'follow_request:' end || new.id)));
  return null;
end;
$$;
comment on function kc_private.follow_requests_enqueue_notification() is
  'AFTER INSERT (pending) or UPDATE to accepted on follow_requests: enqueues the notification.';

create trigger follow_requests_enqueue_request_notification
  after insert on public.follow_requests
  for each row
  when (new.status = 'pending')
  execute function kc_private.follow_requests_enqueue_notification();

create trigger follow_requests_enqueue_approval_notification
  after update of status on public.follow_requests
  for each row
  when (old.status = 'pending' and new.status = 'accepted')
  execute function kc_private.follow_requests_enqueue_notification();
