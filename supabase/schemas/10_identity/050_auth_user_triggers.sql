-- Identity · auth account → member rows
--
-- The auth service owns sign-up. These triggers on `auth.users` create the member's four rows
-- in the same transaction as the auth account, and activate the member once a contact
-- channel is confirmed. They are SECURITY DEFINER because the auth service's role has no
-- access to the product tables.

-- True when the auth account has proven a contact channel: Google and Apple accounts are
-- verified by the provider; email and phone accounts once their confirmation arrived.
create function kc_private.auth_user_is_verified(p_auth_user auth.users)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_auth_user.raw_app_meta_data ->> 'provider', 'email') in ('google', 'apple')
      or p_auth_user.email_confirmed_at is not null
      or p_auth_user.phone_confirmed_at is not null;
$$;

-- Returns a share handle no member holds yet: `u_` plus 12 random hex characters. The
-- handle is random rather than derived from the account id, because a prefix of the id is
-- not unique at scale and a collision would fail the sign-up.
create function kc_private.generate_share_handle()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_handle text;
begin
  loop
    v_handle := 'u_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
    exit when not exists (select 1 from public.users u where u.share_handle = v_handle);
  end loop;
  return v_handle;
end;
$$;

-- Creates the profile, private, account and counter rows of a new member.
create function kc_private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meta constant jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  -- Name offered by the identity provider, else the local part of the email address.
  v_display_name constant text := left(
    coalesce(
      nullif(btrim(coalesce(v_meta ->> 'full_name', v_meta ->> 'name')), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), '')),
    50);
begin
  insert into public.users (id, share_handle, display_name, avatar_url)
  values (
    new.id,
    kc_private.generate_share_handle(),
    v_display_name,
    nullif(coalesce(v_meta ->> 'avatar_url', v_meta ->> 'picture'), ''));

  insert into public.user_private (user_id) values (new.id);
  insert into public.user_stats (user_id) values (new.id);
  insert into public.user_account (user_id, status)
  values (
    new.id,
    case when kc_private.auth_user_is_verified(new) then 'active' else 'pending_verification' end);

  return new;
end;
$$;
comment on function kc_private.handle_new_auth_user() is
  'AFTER INSERT on auth.users: creates the member rows; verified accounts start active.';

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function kc_private.handle_new_auth_user();

-- Activates a member waiting for verification when their email or phone is confirmed.
-- Any other status is left alone: a suspension or a deletion request outranks verification.
create function kc_private.handle_auth_user_verified()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if kc_private.auth_user_is_verified(new) then
    update public.user_account a
       set status = 'active'
     where a.user_id = new.id
       and a.status = 'pending_verification';
  end if;
  return new;
end;
$$;
comment on function kc_private.handle_auth_user_verified() is
  'AFTER UPDATE on auth.users: pending_verification → active once a contact channel is confirmed.';

create trigger on_auth_user_verified
  after update of email_confirmed_at, phone_confirmed_at on auth.users
  for each row execute function kc_private.handle_auth_user_verified();
