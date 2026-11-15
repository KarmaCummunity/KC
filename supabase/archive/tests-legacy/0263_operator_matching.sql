-- supabase/tests/0263_operator_matching.sql | Issue #847

begin;

create or replace function pg_temp.mk_user(p_id uuid, p_handle text)
returns void language plpgsql as $$
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, aud, role)
  values (p_id, p_handle || '@test.local', now(),
          jsonb_build_object('full_name', 'Display ' || p_handle),
          jsonb_build_object('provider', 'email'),
          'authenticated', 'authenticated');
  update public.users
     set share_handle = p_handle, display_name = 'Display ' || p_handle,
         account_status = 'active', privacy_mode = 'Public'
   where user_id = p_id;
end $$;

do $$
declare
  v_owner uuid := '00000000-0000-0000-0000-000000263001';
  v_listing uuid;
  v_case uuid;
begin
  perform pg_temp.mk_user(v_owner, 'op_case_owner');

  insert into public.listings (
    owner_id, world_slug, kind_id, direction, title, origin,
    anonymity_level, moderation_status, published_at, details
  )
  select v_owner, 'money', kind_id, 'request', 'Private aid request', 'native',
         1, 'published', now(), '{}'::jsonb
    from public.listing_kinds
   where world_slug = 'money' and slug = 'financial_aid_request'
  returning listing_id into v_listing;

  select case_id into v_case from public.operator_cases where listing_id = v_listing;
  if v_case is null then
    raise exception 'ASSERT FAILED: level-1 listing should open operator case';
  end if;
end $$;

rollback;

\echo '✓ 0263_operator_matching.sql passed'
