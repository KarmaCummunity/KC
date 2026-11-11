-- 0590_users_date_of_birth | FR-AUTH-010 AC2.d, FR-PROFILE-007 AC7 (D109)
--
-- A private date of birth, required at sign-up and at least 18 years old (the consent screen
-- already makes every new member confirm 18+, FR-AUTH-005 AC5.a; this stores and enforces it).
--
--   * `users.date_of_birth` is nullable: accounts from the retired product (D-190) never saw the KC
--     sign-up, and existing members have none yet. "Required" is enforced in the app flow
--     (basic-info step and the soft gate before the first meaningful action).
--   * Private. The column has no SELECT or UPDATE grant for clients (0163 / 0196 grant
--     column by column), so it is neither readable through `users` nor writable by a plain
--     UPDATE. The owner reads it through `users_get_self_private_fields()`; the only write
--     path is `rpc_set_date_of_birth`, which checks the age on the server, so a modified
--     client cannot skip the rule.
--   * Age is computed against the database date (UTC). A member whose 18th birthday is
--     today in Israel but not yet in UTC waits at most a few hours.

begin;

alter table public.users add column if not exists date_of_birth date;

comment on column public.users.date_of_birth is
  'Private. Owner-only through users_get_self_private_fields(); written by rpc_set_date_of_birth only. 18+ (FR-AUTH-010 AC2.d).';

-- Same body as 0191 plus `date_of_birth`.
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
    'karma_points',               u.karma_points,
    'date_of_birth',              u.date_of_birth
  )
  from public.users u
  where u.user_id = auth.uid();
$$;

comment on function public.users_get_self_private_fields() is
  'Returns PII/privilege/karma columns for auth.uid() only. Complements column grants on public.users (TD-163). 0191 adds karma_points; 0590 adds date_of_birth.';

-- Sets the caller's date of birth. Errors: unauthenticated (42501), invalid_date_of_birth and
-- underage (22023).
create or replace function public.rpc_set_date_of_birth(p_date_of_birth date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  if p_date_of_birth is null
     or p_date_of_birth > current_date
     or p_date_of_birth < date '1900-01-01' then
    raise exception 'invalid_date_of_birth' using errcode = '22023';
  end if;
  if p_date_of_birth > (current_date - interval '18 years')::date then
    raise exception 'underage' using errcode = '22023';
  end if;

  update public.users set date_of_birth = p_date_of_birth where user_id = v_uid;
  if not found then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.rpc_set_date_of_birth(date) from public, anon;
grant execute on function public.rpc_set_date_of_birth(date) to authenticated;

commit;
