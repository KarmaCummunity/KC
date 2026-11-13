-- 0163_users_public_projection | H-BE-03 / FR-PROFILE-007 (TD-163)
--
-- Strip PII and privilege columns from client SELECT on public.users:
-- contact_phone, profile_street(+number), notification_preferences,
-- is_super_admin, active_posts_count_internal.
--
-- Self reads use users_get_self_private_fields(); chat phone uses
-- get_chat_counterparty_contact(chat_id). RLS row policies unchanged.

set search_path = public;

-- ---------------------------------------------------------------------------
-- users_public — documentation + optional PostgREST surface (security_invoker)
-- ---------------------------------------------------------------------------

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
  updated_at
from public.users
where account_status = 'active';

comment on view public.users_public is
  'Non-PII user projection for browse/search surfaces. Column grants on public.users mirror this set; private fields via RPC. TD-163.';

grant select on public.users_public to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Column-scoped SELECT on public.users (RLS still applies per row)
-- ---------------------------------------------------------------------------

revoke select on table public.users from anon, authenticated;

grant select (
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
  updated_at
) on table public.users to anon, authenticated;

-- ---------------------------------------------------------------------------
-- users_get_self_private_fields — owner-only slice (FR-PROFILE-007 edit path)
-- ---------------------------------------------------------------------------

create or replace function public.users_get_self_private_fields()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'contact_phone', u.contact_phone,
    'profile_street', u.profile_street,
    'profile_street_number', u.profile_street_number,
    'notification_preferences', u.notification_preferences,
    'is_super_admin', u.is_super_admin,
    'active_posts_count_internal', u.active_posts_count_internal
  )
  from public.users u
  where u.user_id = auth.uid();
$$;

comment on function public.users_get_self_private_fields() is
  'Returns PII/privilege columns for auth.uid() only. Complements column grants on public.users (TD-163).';

revoke all on function public.users_get_self_private_fields() from public;
grant execute on function public.users_get_self_private_fields() to authenticated;

-- ---------------------------------------------------------------------------
-- get_chat_counterparty_contact — FR-CHAT-014 AC7 / FR-PROFILE-007
-- ---------------------------------------------------------------------------

create or replace function public.get_chat_counterparty_contact(p_chat_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select u.contact_phone
  from public.chats c
  inner join public.users u
    on u.user_id = case
      when c.participant_a = auth.uid() then c.participant_b
      when c.participant_b = auth.uid() then c.participant_a
    end
  where c.chat_id = p_chat_id
    and auth.uid() is not null
    and (c.participant_a = auth.uid() or c.participant_b = auth.uid())
  limit 1;
$$;

comment on function public.get_chat_counterparty_contact(uuid) is
  'Counterpart contact_phone when viewer is a chat participant. Not exposed via general users SELECT (TD-163).';

revoke all on function public.get_chat_counterparty_contact(uuid) from public;
grant execute on function public.get_chat_counterparty_contact(uuid) to authenticated;
