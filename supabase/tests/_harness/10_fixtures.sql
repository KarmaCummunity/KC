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
  v_post_id uuid;
  v_kind_id uuid := kc_test.listing_kind_id(p_world_slug, p_kind_slug);
begin
  perform kc_test.act_as(p_owner_id);
  insert into public.listings (
    owner_id, world_slug, kind_id, direction, title, origin, moderation_status, details, expires_at
  ) values (
    p_owner_id, p_world_slug, v_kind_id, p_direction,
    p_title, 'native', 'published', p_details, coalesce(p_expires_at, nullif(p_details->>'expires_at', '')::timestamptz)
  )
  returning listing_id into v_listing_id;

  if not exists (select 1 from pg_trigger where tgname = 'listings_feed_mirror_sync')
     and (select moderation_status from public.listings where listing_id = v_listing_id) = 'published' then
    insert into public.posts (
      owner_id, type, visibility, title, description, category, city, street, street_number,
      location_display_level, world_slug, direction, post_type, details, category_id,
      expires_at, listing_id, listing_world_slug, kind_id, moderation_status, availability_status,
      urgency_level
    ) values (
      p_owner_id, case p_direction when 'request' then 'Request' else 'Give' end, 'Public',
      left(p_title, 80), null, 'Other', 'tel-aviv', 'Marketplace', '1', 'CityOnly',
      p_world_slug, case p_direction when 'request' then 'request' else 'offer' end,
      case when p_world_slug = 'rides' then 'ride' else 'standard' end,
      coalesce(p_details, '{}'::jsonb), null,
      coalesce(p_expires_at, nullif(p_details->>'expires_at', '')::timestamptz), v_listing_id, p_world_slug, v_kind_id, 'published', 'ongoing',
      (select urgency_level from public.listings where listing_id = v_listing_id)
    )
    returning post_id into v_post_id;

    if p_world_slug = 'rides' then
      insert into public.ride_post_details (
        post_id, departs_at, arrives_at, seats_available, origin_place_id, dest_place_id
      ) values (
        v_post_id,
        nullif(p_details->>'departs_at', '')::timestamptz,
        nullif(p_details->>'arrives_at', '')::timestamptz,
        coalesce((p_details->>'seats_available')::int, 1),
        p_details->>'origin_place_id',
        p_details->>'dest_place_id'
      ) on conflict (post_id) do update set
        departs_at = excluded.departs_at,
        seats_available = excluded.seats_available;
    end if;
  end if;

  return v_listing_id;
end;
$$;

create function kc_test.listing_status(p_listing_id uuid)
returns text
language sql
stable
as $$
  select case
    when exists (select 1 from public.listings where listing_id = p_listing_id) then
      (select status::text from public.listings where listing_id = p_listing_id)
    else
      case (select status::text from public.posts where post_id = p_listing_id)
        when 'closed_delivered' then 'closed'
        when 'paused' then 'cancelled'
        else (select status::text from public.posts where post_id = p_listing_id)
      end
  end;
$$;

create function kc_test.handoff_status(p_handoff_id uuid)
returns text
language sql
stable
as $$
  select coalesce(
    (select status::text from public.giving_handoffs where handoff_id = p_handoff_id),
    (select status::text from public.post_handoffs where handoff_id = p_handoff_id)
  );
$$;
