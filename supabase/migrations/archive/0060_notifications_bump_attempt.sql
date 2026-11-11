-- 0060_notifications_bump_attempt | P1.5 — atomic attempt counter for the dispatcher.

begin;

create or replace function public.notifications_bump_attempt(p_id uuid, p_error text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.notifications_outbox
  set attempts = attempts + 1, last_error = p_error
  where notification_id = p_id;
$$;

revoke all on function public.notifications_bump_attempt(uuid, text) from public;
grant execute on function public.notifications_bump_attempt(uuid, text) to service_role;

commit;
