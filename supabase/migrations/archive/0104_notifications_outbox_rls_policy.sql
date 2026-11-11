-- 0104_notifications_outbox_rls_policy | Internal outbox queue — explicit client deny.
-- FR-NOTIF-* — clients never read/write notifications_outbox directly; DB triggers
-- enqueue via security definer, and dispatch-notification uses service_role.
-- Satisfies supabase/tests/rls-lint.sql (every RLS-enabled table needs ≥1 policy).

create policy "notifications_outbox_deny_clients"
  on public.notifications_outbox
  for all
  to authenticated, anon
  using (false)
  with check (false);
