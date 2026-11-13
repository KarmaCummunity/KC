-- Demo data (FR-ADMIN-031) · the three RPCs of the admin portal's Demo data screen.
--
-- Callable by signed-in members; each one admits only the super admin and the org admin of
-- the platform organization (kc_private.require_demo_data_manager, AC6). They exist only
-- where this seed was installed (kc-dev, local); elsewhere the app gets "function not found"
-- and the screen says the tools are not installed. Errors (P0001 unless noted): forbidden
-- (42501), not_dev_environment (42501), cannot_wipe_self (42501), password_too_short,
-- password_required, demo_operation_busy.

-- AC1: what exists, whether a restore is possible here, and whether a password is saved.
create or replace function public.admin_demo_data_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_state kc_private.demo_data_state;
begin
  perform kc_private.require_demo_data_manager();
  select s.* into v_state from kc_private.demo_data_state s where s.singleton;
  return kc_private.demo_data_counts() || jsonb_build_object(
    'can_seed', coalesce(v_state.is_dev_environment, false),
    'has_saved_password', v_state.password_hash is not null,
    'operation', coalesce(v_state.operation, 'idle'),
    'phase', coalesce(v_state.phase, 'idle'));
end;
$$;
comment on function public.admin_demo_data_status() is
  'FR-ADMIN-031: demo data counts, whether a restore is possible here and whether a password is saved.';

-- AC5: a demo member signed in to the portal would delete its own account mid-operation.
create or replace function kc_private.demo_refuse_self(p_actor_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_actor_id = any (kc_private.demo_member_ids()) then
    raise exception 'cannot_wipe_self' using errcode = '42501';
  end if;
end;
$$;

-- AC2, AC3, AC4: one phase of "delete all demo data". Audited when the last phase completes.
create or replace function public.admin_wipe_demo_data_step()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.require_demo_data_manager();
  v_out jsonb;
begin
  perform kc_private.demo_refuse_self(v_actor);
  v_out := kc_private.demo_advance('wipe', v_actor);
  if (v_out ->> 'done')::boolean then
    perform kc_private.audit_record('admin_wipe_demo_data', null, null, v_out -> 'result', v_actor);
  end if;
  return v_out;
end;
$$;
comment on function public.admin_wipe_demo_data_step() is
  'FR-ADMIN-031: runs the next phase of the demo-data wipe; call until done. Audited on completion.';

-- AC7, AC8, AC9: one phase of "restore demo data" (wipe, then recreate). `p_password` is the
-- demo members' login password: needed once (at least 8 characters), kept only as a bcrypt
-- hash, and a new value replaces the saved one. Audited when the last phase completes.
create or replace function public.admin_seed_demo_data_step(p_password text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.require_demo_data_manager();
  v_out jsonb;
begin
  perform kc_private.demo_refuse_self(v_actor);
  if not exists (select 1 from kc_private.demo_data_state s where s.singleton and s.is_dev_environment) then
    raise exception 'not_dev_environment' using errcode = '42501';
  end if;
  if p_password is not null then
    if char_length(p_password) < 8 then
      raise exception 'password_too_short' using errcode = 'P0001';
    end if;
    update kc_private.demo_data_state
       set password_hash = extensions.crypt(p_password, extensions.gen_salt('bf'))
     where singleton;
  end if;

  v_out := kc_private.demo_advance('seed', v_actor);
  if (v_out ->> 'done')::boolean then
    -- Counts only: the password and its hash never reach the trail.
    perform kc_private.audit_record('admin_seed_demo_data', null, null, v_out -> 'result', v_actor);
  end if;
  return v_out;
end;
$$;
comment on function public.admin_seed_demo_data_step(text) is
  'FR-ADMIN-031: runs the next phase of the demo-data restore (kc-dev only); call until done. Audited on completion.';

-- Functions are private by default (the baseline's default privileges); the portal RPCs are
-- opened to signed-in members, whose rights the bodies check.
revoke all on function public.admin_demo_data_status() from public, anon;
revoke all on function public.admin_wipe_demo_data_step() from public, anon;
revoke all on function public.admin_seed_demo_data_step(text) from public, anon;
grant execute on function public.admin_demo_data_status() to authenticated;
grant execute on function public.admin_wipe_demo_data_step() to authenticated;
grant execute on function public.admin_seed_demo_data_step(text) to authenticated;
