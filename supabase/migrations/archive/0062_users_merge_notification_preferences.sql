-- 0062_users_merge_notification_preferences | P1.5 — FR-NOTIF-014, FR-SETTINGS-005.
-- Atomic merge of notification_preferences jsonb. Caller can update one or
-- both toggles; un-mentioned keys are preserved.

begin;

create or replace function public.users_merge_notification_preferences(p_user_id uuid, p_merge jsonb)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.users
  set notification_preferences = notification_preferences || p_merge
  where user_id = p_user_id and user_id = auth.uid()
  returning notification_preferences;
$$;

revoke all on function public.users_merge_notification_preferences(uuid, jsonb) from public;
grant execute on function public.users_merge_notification_preferences(uuid, jsonb) to authenticated;

commit;
