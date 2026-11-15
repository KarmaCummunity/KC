-- 0032_followrequests_auto_approve_on_public
-- FR-PROFILE-006 AC2: when a user toggles privacy_mode from 'Private' to 'Public',
-- every currently-pending follow_request targeting them transitions atomically
-- to 'accepted'. The existing follow_requests_after_accept trigger then creates
-- the matching follow_edges row for each, and the follow_edges_after_insert_counters
-- trigger keeps the followers/following counters in sync. No application code is
-- needed; the toggle in setPrivacyMode() inherits the behaviour transactionally.
--
-- Edge cases per FR-PROFILE-006 "Edge Cases":
--   - Pending requests from blocked counterparts were already cancelled by
--     blocks_apply_side_effects (0003 §14), so they do not appear in the
--     `status = 'pending'` filter here. No special-casing needed.
--   - Auto-approval of thousands of requests runs in a single SQL statement;
--     each accepted row fires the FR-FOLLOW-005 edge-creation trigger atomically.

create or replace function public.users_on_privacy_mode_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.privacy_mode = 'Private' and new.privacy_mode = 'Public' then
    update public.follow_requests
    set status = 'accepted'
    where target_id = new.user_id
      and status    = 'pending';
  end if;
  return new;
end;
$$;

drop trigger if exists users_after_privacy_mode_change on public.users;
create trigger users_after_privacy_mode_change
  after update of privacy_mode on public.users
  for each row
  when (old.privacy_mode is distinct from new.privacy_mode)
  execute function public.users_on_privacy_mode_change();
