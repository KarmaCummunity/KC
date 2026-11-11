-- Messaging · realtime of the member's own account (M24)
--
-- Topic `user:<user_id>:account`, event `account_changed`: the account gate changed — a
-- suspension, a ban, a lifted sanction, a deletion request or its restore — so the app
-- leaves or re-enters the main screens at once instead of at the next request. The payload
-- is the gate itself (status, until, onboarding state) and nothing else. Who may listen is
-- the policy on a member's own `user:<id>:…` topics in 060_realtime.sql; the send is a no-op
-- where the platform's realtime schema is absent (kc_private.broadcast). The sender lives
-- here, not in 10_identity, because the broadcast helper belongs to this module's realtime
-- wiring and sorts after the identity files.

create function kc_private.user_account_broadcast_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform kc_private.broadcast('user:' || new.user_id || ':account', 'account_changed', jsonb_build_object(
    'status', new.status,
    'status_until', new.status_until,
    'onboarding_state', new.onboarding_state));
  return null;
end;
$$;
comment on function kc_private.user_account_broadcast_gate() is
  'AFTER UPDATE on user_account: tells the member''s own topic that status, suspension end or onboarding state changed.';

create trigger user_account_broadcast_gate
  after update of status, status_until, onboarding_state on public.user_account
  for each row
  when (old.status is distinct from new.status
        or old.status_until is distinct from new.status_until
        or old.onboarding_state is distinct from new.onboarding_state)
  execute function kc_private.user_account_broadcast_gate();
