-- 0549_admin_demo_data_reset | FR-ADMIN-031: super admin can remove the kc-dev demo data from the portal.
--
-- The kc-dev fake seed (supabase/seed/kc-dev/seed.sql) creates ~200 users `userN@seed.kc.test`
-- (auth app_metadata.seed = true) plus everything hanging off them, and three "[DEMO]" nonprofits
-- (organizations.verification_method = 'demo_seed'). This migration exposes two super-admin RPCs:
--   admin_demo_data_status()  how many demo users / demo nonprofits exist right now
--   admin_wipe_demo_data()    deletes them (same scope as seed/kc-dev/wipe.sql) and audit-logs it
-- Restoring the demo data stays the existing "Seed KC dev" workflow.
--
-- Safety: both functions only ever match auth users flagged app_metadata.seed = true AND with the
-- reserved `.test` seed domain. Real users can never carry that flag (only the seed script sets it),
-- so on prod (no such users) the wipe is a no-op that deletes nothing.

begin;

-- ── 1. Audit allow-list: add 'admin_wipe_demo_data' to the v8 list (0203) ──────────────
alter table public.audit_events
  drop constraint if exists audit_events_action_check;
alter table public.audit_events
  add constraint audit_events_action_check_v9 check (action in (
    'block_user','unblock_user',
    'report_target',
    'auto_remove_target','manual_remove_target','restore_target',
    'suspend_user','unsuspend_user',
    'ban_user',
    'false_report_sanction_applied',
    'dismiss_report','confirm_report',
    'delete_message',
    'delete_account',
    'unmark_recipient_self',
    'admin_role_grant','admin_role_revoke',
    'admin_task_create','admin_task_update','admin_task_delete',
    'org_application_approve','org_application_reject',
    'post_edited',
    'admin_set_manager',
    'admin_wipe_demo_data'
  )) not valid;
alter table public.audit_events validate constraint audit_events_action_check_v9;
alter table public.audit_events
  rename constraint audit_events_action_check_v9 to audit_events_action_check;

-- ── 2. Shared predicate: is this auth user a kc-dev seed user? ──────────────────────────
create or replace function public.is_demo_seed_user(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from auth.users u
     where u.id = p_user_id
       and u.email like '%@seed.kc.test'
       and coalesce(u.raw_app_meta_data->>'seed', '') = 'true'
  );
$$;

comment on function public.is_demo_seed_user(uuid) is
  'True for kc-dev fake seed users (@seed.kc.test with app_metadata.seed = true). Internal helper for the demo-data admin RPCs.';

revoke all on function public.is_demo_seed_user(uuid) from public, anon, authenticated;

-- ── 3. admin_demo_data_status ───────────────────────────────────────────────────────────
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
begin
  perform public.admin_assert_role(auth.uid(), array['super_admin']);

  select count(*) into v_users
    from auth.users u
   where u.email like '%@seed.kc.test'
     and coalesce(u.raw_app_meta_data->>'seed', '') = 'true';

  select count(*) into v_orgs
    from public.organizations o
   where o.verification_method = 'demo_seed';

  return jsonb_build_object('demo_users', v_users, 'demo_organizations', v_orgs);
end;
$$;

comment on function public.admin_demo_data_status() is
  'FR-ADMIN-031: counts of kc-dev demo users and demo nonprofits still present. Super admin only.';

revoke all on function public.admin_demo_data_status() from public, anon;
grant execute on function public.admin_demo_data_status() to authenticated;

-- ── 4. admin_wipe_demo_data ─────────────────────────────────────────────────────────────
create or replace function public.admin_wipe_demo_data()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
-- Deleting ~200 users cascades through posts, chats, messages and follows; the default
-- PostgREST statement timeout for `authenticated` is too short for that.
set statement_timeout = '180s'
as $$
declare
  v_actor        uuid := auth.uid();
  v_users        integer;
  v_orgs_deleted integer := 0;
  v_orgs_kept    integer := 0;
  v_org_id       uuid;
begin
  perform public.admin_assert_role(v_actor, array['super_admin']);

  -- Wiping the account that performs the wipe would orphan the session mid-call.
  if public.is_demo_seed_user(v_actor) then
    raise exception 'cannot_wipe_self' using errcode = '42501';
  end if;

  -- Chats first: their participant FKs do not cascade from users (same order as wipe.sql).
  delete from public.chats c
   where exists (select 1 from auth.users u
                  where u.id in (c.participant_a, c.participant_b)
                    and u.email like '%@seed.kc.test'
                    and coalesce(u.raw_app_meta_data->>'seed', '') = 'true');

  -- Cascades from auth.users to public.users and all of their content.
  delete from auth.users u
   where u.email like '%@seed.kc.test'
     and coalesce(u.raw_app_meta_data->>'seed', '') = 'true';
  get diagnostics v_users = row_count;

  -- Demo nonprofits are not owned by seed users. One that has real payment history
  -- (non-cascading FKs) is kept and reported instead of failing the whole wipe.
  for v_org_id in
    select o.org_id from public.organizations o where o.verification_method = 'demo_seed'
  loop
    begin
      delete from public.organizations where org_id = v_org_id;
      v_orgs_deleted := v_orgs_deleted + 1;
    exception when foreign_key_violation then
      v_orgs_kept := v_orgs_kept + 1;
    end;
  end loop;

  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (v_actor, 'admin_wipe_demo_data', 'none', null,
          jsonb_build_object('users_deleted', v_users,
                             'organizations_deleted', v_orgs_deleted,
                             'organizations_kept', v_orgs_kept));

  return jsonb_build_object('users_deleted', v_users,
                            'organizations_deleted', v_orgs_deleted,
                            'organizations_kept', v_orgs_kept);
end;
$$;

comment on function public.admin_wipe_demo_data() is
  'FR-ADMIN-031: deletes the kc-dev demo data (seed users + their content, [DEMO] nonprofits) and audit-logs it. Super admin only; a no-op where no demo data exists.';

revoke all on function public.admin_wipe_demo_data() from public, anon;
grant execute on function public.admin_wipe_demo_data() to authenticated;

commit;
