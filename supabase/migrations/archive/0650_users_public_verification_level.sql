-- 0650_users_public_verification_level | FR-VERIFY-001 AC2
-- Migration 0637 added users.verification_level and column grants, but posts embed
-- owner through users_public (0163), which never projected the column — feed and
-- post detail always mapped owner verification to 0.

set search_path = public;

create or replace view public.users_public
with (security_invoker = true)
as
select
  user_id,
  auth_provider,
  share_handle,
  display_name,
  city,
  city_name,
  biography,
  avatar_url,
  privacy_mode,
  privacy_changed_at,
  account_status,
  onboarding_state,
  basic_info_skipped,
  closure_explainer_dismissed,
  first_post_nudge_dismissed,
  items_given_count,
  items_received_count,
  followers_count,
  following_count,
  created_at,
  updated_at,
  verification_level
from public.users
where account_status = 'active';

comment on view public.users_public is
  'Non-PII user projection for browse/search surfaces. Includes verification_level (FR-VERIFY-001). TD-163.';

grant select on public.users_public to anon, authenticated;
