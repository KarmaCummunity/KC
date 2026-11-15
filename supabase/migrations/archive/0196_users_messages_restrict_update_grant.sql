-- 0196_users_messages_restrict_update_grant | FR-PROFILE-*, FR-CHAT-* (security audit 2026-06-14, Findings H1 + M1) — CRITICAL
--
-- CRITICAL privilege escalation. Any authenticated user could run
--     update public.users set is_super_admin = true where user_id = auth.uid();
-- and become platform super-admin — the AFTER-UPDATE trigger
-- users_sync_admin_role_grants then inserts the super_admin row into
-- admin_role_grants, unlocking every admin_* RPC and all moderation/finance/CRM
-- data. The same hole let a user self-set account_status (ban/suspension
-- evasion), inflate karma_points / followers_count / items_*_count /
-- posts_created_total (leaderboard + stats forgery), and zero
-- false_reports_count / false_report_sanction_count (sanction evasion).
--
-- Root cause: RLS policy users_update_self gates only on row ownership
-- (auth.uid() = user_id) and NOT on columns. The intended defense was a narrow
-- column-level UPDATE grant (see the 0006 comment "column-grant on users
-- intentionally forbids clients"), but Supabase default privileges grant ALL on
-- every table to anon/authenticated, silently overriding it — so authenticated
-- effectively held UPDATE on EVERY column. Confirmed live:
--   has_column_privilege('authenticated','public.users','is_super_admin','UPDATE') = true
--
-- The identical default-privilege override defeated 0004's `grant update (status)`
-- on messages, letting any chat participant rewrite the counterpart's message
-- body / sender_id / created_at / system_payload (message forgery, Finding M1).
--
-- Fix: revoke the table-wide UPDATE and re-grant UPDATE only on the columns the
-- client legitimately writes (verified against packages/infrastructure-supabase).
-- System-owned columns are now unreachable from the client; they are maintained
-- by SECURITY DEFINER RPCs, triggers (search_vector, updated_at via NEW.* — no
-- grant needed) and cron.

begin;

-- ── users ────────────────────────────────────────────────────────────────────
-- Legitimate client writes: profile edit (display_name, biography, avatar_url,
-- city, city_name, contact_phone, profile_street[_number]), privacy toggle
-- (privacy_mode + privacy_changed_at), onboarding (onboarding_state,
-- basic_info_skipped), and the two UI dismiss flags.
revoke update on public.users from anon, authenticated;
grant update (
  display_name,
  biography,
  avatar_url,
  city,
  city_name,
  contact_phone,
  profile_street,
  profile_street_number,
  privacy_mode,
  privacy_changed_at,
  onboarding_state,
  basic_info_skipped,
  closure_explainer_dismissed,
  first_post_nudge_dismissed
) on public.users to authenticated;

-- ── messages ─────────────────────────────────────────────────────────────────
-- Read-receipt status transitions only (restores 0004's intent). body,
-- sender_id, chat_id, created_at and system_payload are immutable from the
-- client; the BEFORE UPDATE OF status trigger maintains delivered_at/read_at.
revoke update on public.messages from anon, authenticated;
grant update (status) on public.messages to authenticated;

commit;
