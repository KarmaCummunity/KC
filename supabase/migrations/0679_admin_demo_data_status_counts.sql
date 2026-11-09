-- 0679_admin_demo_data_status_counts | FR-ADMIN-031 #1964: grounded KPIs on the demo-data screen.

begin;

create or replace function public.admin_demo_data_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_users integer;
  v_orgs  integer;
  v_ride_posts integer;
  v_item_posts integer;
  v_legacy_rides integer;
  v_org_memberships integer;
  v_post_media integer;
  v_cfg   public.kc_dev_demo_config;
begin
  if not public.can_manage_demo_data(auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_cfg from public.kc_dev_demo_config;

  select count(*) into v_users
    from auth.users u
   where u.email like '%@seed.kc.test'
     and coalesce(u.raw_app_meta_data->>'seed', '') = 'true';

  select count(*) into v_orgs
    from public.organizations o
   where o.verification_method = 'demo_seed';

  select count(*) into v_ride_posts
    from public.posts p
    join auth.users a on a.id = p.owner_id
   where a.email like '%@seed.kc.test'
     and coalesce(a.raw_app_meta_data->>'seed', '') = 'true'
     and p.world_slug = 'rides'
     and p.post_type = 'ride';

  select count(*) into v_item_posts
    from public.posts p
    join auth.users a on a.id = p.owner_id
   where a.email like '%@seed.kc.test'
     and coalesce(a.raw_app_meta_data->>'seed', '') = 'true'
     and coalesce(p.world_slug, '') <> 'rides';

  select count(*) into v_legacy_rides
    from public.ride_listings r
    join auth.users a on a.id = r.owner_id
   where a.email like '%@seed.kc.test'
     and coalesce(a.raw_app_meta_data->>'seed', '') = 'true';

  select count(*) into v_org_memberships
    from public.org_memberships m
    join public.organizations o on o.org_id = m.org_id
   where o.verification_method = 'demo_seed';

  select count(*) into v_post_media
    from public.media_assets ma
    join public.posts p on p.post_id = ma.post_id
    join auth.users a on a.id = p.owner_id
   where a.email like '%@seed.kc.test'
     and coalesce(a.raw_app_meta_data->>'seed', '') = 'true'
     and ma.path like 'demo/kc-dev/%';

  return jsonb_build_object(
    'demo_users', v_users,
    'demo_organizations', v_orgs,
    'demo_ride_posts', v_ride_posts,
    'demo_item_posts', v_item_posts,
    'demo_legacy_ride_listings', v_legacy_rides,
    'demo_org_memberships', v_org_memberships,
    'demo_post_media', v_post_media,
    'can_seed', v_cfg.singleton is not null,
    'has_saved_password', v_cfg.password_hash is not null);
end;
$$;

comment on function public.admin_demo_data_status() is
  'FR-ADMIN-031: demo inventory (users, orgs, ride/item posts, legacy ride_listings, org roles, media rows) plus seed capability flags. Super admin or platform org admin only.';

commit;
