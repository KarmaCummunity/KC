-- kc_test fixtures | World-agnostic builders for users and listings (G38).
-- World-specific builders live in 20_world_<slug>.sql and compose these.

-- Creates an auth user; the on-signup trigger provisions public.users, which is then
-- shaped into an active public member. Returns the user id so tests never hard-code it.
create function kc_test.create_user(
  p_handle text,
  p_user_id uuid default gen_random_uuid()
)
returns uuid
language plpgsql
as $$
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, aud, role)
  values (p_user_id, p_handle || '@kc-test.local', now(),
          jsonb_build_object('full_name', 'Test ' || p_handle),
          jsonb_build_object('provider', 'email'),
          'authenticated', 'authenticated');

  update public.users
     set share_handle = p_handle,
         display_name = 'Test ' || p_handle,
         account_status = 'active',
         privacy_mode = 'Public'
   where user_id = p_user_id;

  return p_user_id;
end;
$$;

create function kc_test.listing_kind_id(p_world_slug text, p_kind_slug text)
returns uuid
language plpgsql
stable
as $$
declare
  v_kind_id uuid;
begin
  select kind_id into v_kind_id
    from public.listing_kinds
   where world_slug = p_world_slug and slug = p_kind_slug;
  if v_kind_id is null then
    perform kc_test.fail(format('unknown listing kind %s/%s', p_world_slug, p_kind_slug));
  end if;
  return v_kind_id;
end;
$$;

-- Inserts a published, open listing owned by p_owner_id, the way the native create
-- flow stores it. Acts as the owner so owner-scoped triggers see the right caller.
create function kc_test.create_listing(
  p_owner_id uuid,
  p_world_slug text,
  p_kind_slug text,
  p_direction text,
  p_title text,
  p_details jsonb,
  p_expires_at timestamptz default now() + interval '1 day'
)
returns uuid
language plpgsql
as $$
declare
  v_listing_id uuid;
begin
  perform kc_test.act_as(p_owner_id);
  insert into public.listings (
    owner_id, world_slug, kind_id, direction, title, origin, moderation_status, details, expires_at
  ) values (
    p_owner_id, p_world_slug, kc_test.listing_kind_id(p_world_slug, p_kind_slug), p_direction,
    p_title, 'native', 'published', p_details, p_expires_at
  )
  returning listing_id into v_listing_id;
  return v_listing_id;
end;
$$;

create function kc_test.listing_status(p_listing_id uuid)
returns text
language sql
stable
as $$
  select status::text from public.listings where listing_id = p_listing_id;
$$;

create function kc_test.handoff_status(p_handoff_id uuid)
returns text
language sql
stable
as $$
  select status::text from public.giving_handoffs where handoff_id = p_handoff_id;
$$;
