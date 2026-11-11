-- 0191_users_self_private_fields_add_karma | FR-KARMA-007
--
-- users_get_self_private_fields() was created in 0163 before karma_points
-- existed (0188). Add karma_points to the RPC return so the KarmaBadge
-- component receives the correct value when MyProfileChrome calls findById().
--
-- The column has no column-level SELECT grant on public.users for authenticated
-- (intentional — karma is self-only, FR-KARMA-008). Returning it via this
-- SECURITY DEFINER RPC is the correct self-only path.

create or replace function public.users_get_self_private_fields()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'contact_phone',              u.contact_phone,
    'profile_street',             u.profile_street,
    'profile_street_number',      u.profile_street_number,
    'notification_preferences',   u.notification_preferences,
    'is_super_admin',             u.is_super_admin,
    'active_posts_count_internal',u.active_posts_count_internal,
    'karma_points',               u.karma_points
  )
  from public.users u
  where u.user_id = auth.uid();
$$;

comment on function public.users_get_self_private_fields() is
  'Returns PII/privilege/karma columns for auth.uid() only. Complements column grants on public.users (TD-163). 0191 adds karma_points (FR-KARMA-007).';
