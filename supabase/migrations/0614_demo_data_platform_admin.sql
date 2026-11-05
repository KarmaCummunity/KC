-- 0614_demo_data_platform_admin | FR-ADMIN-031 AC6: the platform org's admin may manage demo data too.
--
-- Until now the three demo-data RPCs (0591, 0592) accepted super_admin only. The person who runs the
-- Karma Community org day to day (org_admin scoped to the platform org) needs the same screen, while
-- the org_admins of every other organization must not get it. The rule lives in one predicate so the
-- three RPCs cannot drift apart. Bodies are otherwise unchanged from 0591 / 0592.

begin;

-- ── 1. can_manage_demo_data ─────────────────────────────────────────────────────────────
create or replace function public.can_manage_demo_data(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_uid is not null and exists (
    select 1
      from public.admin_role_grants g
     where g.user_id = p_uid
       and g.revoked_at is null
       and (
         g.role = 'super_admin'
         or (g.role = 'org_admin'
             and g.scope_org_id = (select o.org_id from public.organizations o where o.is_platform))
       )
  );
$$;

comment on function public.can_manage_demo_data(uuid) is
  'FR-ADMIN-031: true for the super admin and for the org_admin of the platform org; false for every other org_admin.';

revoke all on function public.can_manage_demo_data(uuid) from public, anon;
grant execute on function public.can_manage_demo_data(uuid) to authenticated;

-- ── 2. admin_demo_data_status ───────────────────────────────────────────────────────────
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

  return jsonb_build_object(
    'demo_users', v_users,
    'demo_organizations', v_orgs,
    'can_seed', v_cfg.singleton is not null,
    'has_saved_password', v_cfg.password_hash is not null);
end;
$$;

comment on function public.admin_demo_data_status() is
  'FR-ADMIN-031: counts of kc-dev demo users / demo nonprofits, whether a seed is possible here, and whether a seed password is saved. Super admin or platform org admin only.';

revoke all on function public.admin_demo_data_status() from public, anon;
grant execute on function public.admin_demo_data_status() to authenticated;

-- ── 3. admin_wipe_demo_data ─────────────────────────────────────────────────────────────
create or replace function public.admin_wipe_demo_data()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_actor  uuid := auth.uid();
  v_result jsonb;
begin
  if not public.can_manage_demo_data(v_actor) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Wiping the account that performs the wipe would orphan the session mid-call.
  if public.is_demo_seed_user(v_actor) then
    raise exception 'cannot_wipe_self' using errcode = '42501';
  end if;

  v_result := public.kc_dev_wipe_demo_data();

  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (v_actor, 'admin_wipe_demo_data', 'none', null, v_result);

  return v_result;
end;
$$;

comment on function public.admin_wipe_demo_data() is
  'FR-ADMIN-031: deletes the kc-dev demo data (seed users + their content, [DEMO] nonprofits) and audit-logs it. Super admin or platform org admin only; a no-op where no demo data exists.';

revoke all on function public.admin_wipe_demo_data() from public, anon;
grant execute on function public.admin_wipe_demo_data() to authenticated;

-- ── 4. admin_seed_demo_data ─────────────────────────────────────────────────────────────
create or replace function public.admin_seed_demo_data(p_password text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
set statement_timeout = '300s'
as $$
declare
  v_actor  uuid := auth.uid();
  v_hash   text;
  v_result jsonb;
begin
  if not public.can_manage_demo_data(v_actor) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if not exists (select 1 from public.kc_dev_demo_config) then
    raise exception 'not_dev_environment' using errcode = '42501';
  end if;

  if p_password is not null and length(p_password) < 8 then
    raise exception 'password_too_short' using errcode = '22023';
  end if;

  if p_password is not null then
    v_hash := extensions.crypt(p_password, extensions.gen_salt('bf'));
    update public.kc_dev_demo_config set password_hash = v_hash;
  else
    select password_hash into v_hash from public.kc_dev_demo_config;
  end if;
  if v_hash is null then
    raise exception 'password_required' using errcode = '22023';
  end if;

  v_result := public.kc_dev_seed_demo_data(v_hash);

  -- The seed cleared the JWT claims to keep triggers neutral; restore the caller for the audit row.
  perform set_config('request.jwt.claim.sub', v_actor::text, true);
  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (v_actor, 'admin_seed_demo_data', 'none', null, v_result);

  return v_result;
end;
$$;

comment on function public.admin_seed_demo_data(text) is
  'FR-ADMIN-031: restores the kc-dev demo data (wipe + reseed) and audit-logs it. Super admin or platform org admin only; refused (not_dev_environment) anywhere but kc-dev.';

revoke all on function public.admin_seed_demo_data(text) from public, anon;
grant execute on function public.admin_seed_demo_data(text) to authenticated;

commit;
