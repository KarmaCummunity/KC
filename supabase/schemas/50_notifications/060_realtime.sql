-- Notifications · realtime
--
-- Topic `user:<user_id>:notifications`, event `badge`: the member's notification centre
-- changed; the payload is the new unread count and nothing else. Who may listen is decided
-- by the policy on the member's own topics in 40_messaging/060_realtime.sql, and the send
-- is a no-op where the platform's realtime schema is absent (kc_private.broadcast).
-- Per statement, so that "mark all read" sends one event, not one per row.

create function kc_private.notifications_broadcast_badge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  for v_user_id in select distinct r.user_id from changed_rows r loop
    perform kc_private.broadcast('user:' || v_user_id || ':notifications', 'badge', jsonb_build_object(
      'unread_count', (select count(*) from public.notifications n
                        where n.user_id = v_user_id and n.read_at is null)));
  end loop;
  return null;
end;
$$;
comment on function kc_private.notifications_broadcast_badge() is
  'AFTER INSERT / UPDATE on notifications (per statement): broadcasts each affected member''s unread count.';

create trigger notifications_broadcast_badge_insert
  after insert on public.notifications
  referencing new table as changed_rows
  for each statement execute function kc_private.notifications_broadcast_badge();

create trigger notifications_broadcast_badge_update
  after update on public.notifications
  referencing new table as changed_rows
  for each statement execute function kc_private.notifications_broadcast_badge();
