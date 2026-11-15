-- 0203_admin_org_hierarchy — P3.A-Tree Phase 2: organisations entity +
-- direct-manager link + hierarchy tree RPCs.
--
-- Adds:
--   • `organizations` table (Karma Community seeded as the single platform org).
--   • FK `admin_role_grants.scope_org_id -> organizations(org_id)` (the FK that
--     migration 0173 deferred). Orphan scope ids are backfilled as placeholder
--     orgs first so the constraint validates cleanly.
--   • `manager_grant_id` self-reference on admin_role_grants (per-grant direct
--     manager — a person can sit under different managers in different orgs).
--   • `is_ancestor(p_ancestor, p_node)` recursive helper (also used by Phase 3
--     field-level privacy gating).
--   • `admin_set_manager(p_grant_id, p_manager_grant_id)` SECURITY DEFINER —
--     authority + same-org + cycle gates, audit-logged.
--   • `admin_org_tree(p_org_id default null)` SECURITY DEFINER — RBAC-filtered
--     adjacency list (caller's own org subtree; super_admin sees all / any org).
--
-- Mapped to spec: FR-ADMIN-024 (organisations entity), FR-ADMIN-025 (direct
-- manager link + hierarchy tree), docs/SSOT/spec/12_super_admin.md §16.
-- Decision: D-60 (per-grant manager edge granularity).

-- ── 1. organizations table ─────────────────────────────────────────────────
create table if not exists public.organizations (
  org_id      uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 120),
  slug        text not null unique check (slug ~ '^[a-z0-9-]{1,60}$'),
  is_platform boolean not null default false,
  created_at  timestamptz not null default now()
);

comment on table public.organizations is
  'Organisations using the platform. Karma Community is the single platform org (is_platform=true) and holds the platform-wide admin roles.';

-- At most one platform org.
create unique index if not exists organizations_single_platform_uniq
  on public.organizations (is_platform)
  where is_platform;

alter table public.organizations enable row level security;

-- Public read of the non-sensitive org roster (powers the About tree, Phase 3).
drop policy if exists organizations_public_read on public.organizations;
create policy organizations_public_read
  on public.organizations for select
  using (true);

-- Writes go through RPCs / direct DB ops only — no client INSERT/UPDATE/DELETE.

-- ── 2. Seed Karma Community as the platform org ────────────────────────────
insert into public.organizations (org_id, name, slug, is_platform)
values (
  '00000000-0000-0000-0000-000000000001'::uuid,
  'Karma Community',
  'karma-community',
  true
)
on conflict (org_id) do nothing;

-- ── 3. Backfill orphan scope ids + add the deferred FK ─────────────────────
-- Any grant scope_org_id without a matching org becomes a placeholder org so
-- the FK validates without dropping data (backward-compatible per §6 release
-- guard). These are real org-scoped grants whose org row never existed.
insert into public.organizations (org_id, name, slug, is_platform)
select distinct
  g.scope_org_id,
  'Organisation ' || left(g.scope_org_id::text, 8),
  'org-' || left(g.scope_org_id::text, 8),
  false
from public.admin_role_grants g
where g.scope_org_id is not null
  and not exists (
    select 1 from public.organizations o where o.org_id = g.scope_org_id
  )
on conflict (org_id) do nothing;

alter table public.admin_role_grants
  drop constraint if exists admin_role_grants_scope_org_fk;
alter table public.admin_role_grants
  add constraint admin_role_grants_scope_org_fk
  foreign key (scope_org_id) references public.organizations(org_id)
  on delete restrict
  not valid;
alter table public.admin_role_grants
  validate constraint admin_role_grants_scope_org_fk;

-- ── 4. Direct-manager link ─────────────────────────────────────────────────
alter table public.admin_role_grants
  add column if not exists manager_grant_id uuid
  references public.admin_role_grants(grant_id) on delete set null;

comment on column public.admin_role_grants.manager_grant_id is
  'Direct-manager edge: the grant this grant reports to. NULL = tree root. Same-org (or platform manager) + acyclic, enforced by admin_set_manager.';

alter table public.admin_role_grants
  drop constraint if exists admin_role_grants_no_self_manager;
alter table public.admin_role_grants
  add constraint admin_role_grants_no_self_manager
  check (manager_grant_id is null or manager_grant_id <> grant_id);

create index if not exists admin_role_grants_manager_idx
  on public.admin_role_grants (manager_grant_id)
  where manager_grant_id is not null;

-- ── 5. is_ancestor recursive helper ────────────────────────────────────────
-- True when p_ancestor sits somewhere above p_node in the manager chain.
-- Data is acyclic (admin_set_manager rejects cycles), so the walk terminates.
create or replace function public.is_ancestor(p_ancestor uuid, p_node uuid)
returns boolean
language sql
stable security definer
set search_path = public
as $$
  with recursive chain as (
    select manager_grant_id as gid
      from public.admin_role_grants
      where grant_id = p_node and manager_grant_id is not null
    union all
    select g.manager_grant_id
      from public.admin_role_grants g
      join chain c on g.grant_id = c.gid
      where g.manager_grant_id is not null
  )
  select coalesce(p_ancestor is not null and exists (
    select 1 from chain where gid = p_ancestor
  ), false);
$$;

revoke execute on function public.is_ancestor(uuid, uuid) from public;
grant  execute on function public.is_ancestor(uuid, uuid) to authenticated;

-- ── 6. Widen audit action allow-list (v7 -> v8) ────────────────────────────
alter table public.audit_events
  drop constraint if exists audit_events_action_check;
alter table public.audit_events
  add constraint audit_events_action_check_v8 check (action in (
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
    'admin_set_manager'
  )) not valid;
alter table public.audit_events validate constraint audit_events_action_check_v8;
alter table public.audit_events
  rename constraint audit_events_action_check_v8 to audit_events_action_check;

-- ── 7. admin_set_manager ───────────────────────────────────────────────────
create or replace function public.admin_set_manager(
  p_grant_id uuid,
  p_manager_grant_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor      uuid := auth.uid();
  v_g_role     text;
  v_g_scope    uuid;
  v_g_revoked  timestamptz;
  v_m_scope    uuid;
  v_m_revoked  timestamptz;
begin
  if v_actor is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_grant_id is null then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  select role, scope_org_id, revoked_at
    into v_g_role, v_g_scope, v_g_revoked
    from public.admin_role_grants
    where grant_id = p_grant_id
    for update;
  if v_g_role is null then
    raise exception 'grant_not_found' using errcode = 'P0002';
  end if;
  if v_g_revoked is not null then
    raise exception 'grant_already_revoked' using errcode = '23514';
  end if;

  -- Authority: same gate as assigning the grant's role in its scope.
  if not (
    public.has_admin_role(v_actor, 'super_admin', null)
    or public.can_grant_role(v_actor, v_g_role, v_g_scope)
  ) then
    raise exception 'forbidden_manage' using errcode = '42501';
  end if;

  -- Clear the manager (detach to a tree root).
  if p_manager_grant_id is null then
    update public.admin_role_grants
       set manager_grant_id = null
     where grant_id = p_grant_id;
    insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
    values (v_actor, 'admin_set_manager', 'user',
            (select user_id from public.admin_role_grants where grant_id = p_grant_id),
            jsonb_build_object('grant_id', p_grant_id, 'manager_grant_id', null));
    return;
  end if;

  if p_manager_grant_id = p_grant_id then
    raise exception 'invalid_manager' using errcode = '22023',
      detail = 'a grant cannot manage itself';
  end if;

  select scope_org_id, revoked_at
    into v_m_scope, v_m_revoked
    from public.admin_role_grants
    where grant_id = p_manager_grant_id;
  if not found then
    raise exception 'manager_not_found' using errcode = 'P0002';
  end if;
  if v_m_revoked is not null then
    raise exception 'manager_revoked' using errcode = '23514';
  end if;

  -- Same-org rule: a platform grant (scope null) may only sit under another
  -- platform grant; an org grant may sit under its own org or a platform grant.
  if v_g_scope is null then
    if v_m_scope is not null then
      raise exception 'manager_other_org' using errcode = '22023';
    end if;
  elsif v_m_scope is not null and v_m_scope <> v_g_scope then
    raise exception 'manager_other_org' using errcode = '22023';
  end if;

  -- Cycle guard: the grant must not already be an ancestor of the new manager.
  if public.is_ancestor(p_grant_id, p_manager_grant_id) then
    raise exception 'manager_cycle' using errcode = 'P0001';
  end if;

  update public.admin_role_grants
     set manager_grant_id = p_manager_grant_id
   where grant_id = p_grant_id;

  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (v_actor, 'admin_set_manager', 'user',
          (select user_id from public.admin_role_grants where grant_id = p_grant_id),
          jsonb_build_object('grant_id', p_grant_id,
                             'manager_grant_id', p_manager_grant_id,
                             'role', v_g_role,
                             'scope_org_id', v_g_scope));
end;
$$;

revoke execute on function public.admin_set_manager(uuid, uuid) from public;
grant  execute on function public.admin_set_manager(uuid, uuid) to authenticated;

-- ── 8. admin_org_tree — RBAC-filtered adjacency list ───────────────────────
create or replace function public.admin_org_tree(p_org_id uuid default null)
returns table (
  grant_id         uuid,
  user_id          uuid,
  display_name     text,
  avatar_url       text,
  role             text,
  scope_org_id     uuid,
  effective_org_id uuid,
  org_name         text,
  is_platform      boolean,
  manager_grant_id uuid,
  last_seen_at     timestamptz
)
language plpgsql
stable security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_actor        uuid := auth.uid();
  v_is_super     boolean;
  v_platform_org uuid;
begin
  if v_actor is null
     or not exists (
       select 1 from public.admin_role_grants arg
       where arg.user_id = v_actor and arg.revoked_at is null
     ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_is_super := public.has_admin_role(v_actor, 'super_admin', null);
  select org_id into v_platform_org
    from public.organizations where is_platform limit 1;

  return query
  with effective as (
    select g.*, coalesce(g.scope_org_id, v_platform_org) as eff_org
      from public.admin_role_grants g
      where g.revoked_at is null
  ),
  my_orgs as (
    select distinct e.eff_org from effective e where e.user_id = v_actor
  )
  select
    e.grant_id,
    e.user_id,
    u.display_name,
    u.avatar_url,
    e.role,
    e.scope_org_id,
    e.eff_org,
    o.name,
    coalesce(o.is_platform, false),
    e.manager_grant_id,
    (select max(d.last_seen_at) from public.devices d where d.user_id = e.user_id)
  from effective e
  join public.users u on u.user_id = e.user_id
  left join public.organizations o on o.org_id = e.eff_org
  where (v_is_super or e.eff_org in (select eff_org from my_orgs))
    and (p_org_id is null or e.eff_org = p_org_id)
  order by o.name nulls first, e.role, u.display_name;
end;
$$;

revoke execute on function public.admin_org_tree(uuid) from public;
grant  execute on function public.admin_org_tree(uuid) to authenticated;
