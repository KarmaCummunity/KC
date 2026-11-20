-- Production copy (FR-ADMIN-037) · the two RPCs of the "Copied from production" card on the
-- admin portal's Demo data screen (AC13).
--
-- The card admits the same people as the demo data (FR-ADMIN-031 AC6), so both RPCs start with
-- kc_private.require_demo_data_manager from the demo-data tools (supabase/seed/demo), which every
-- dev deploy installs right before these. They exist only where this seed was installed (kc-dev,
-- local); elsewhere the app gets "function not found" and does not show the card.
-- Errors: forbidden (42501).

-- What the copy holds now, and when the last successful copy ran.
create or replace function public.admin_prod_copy_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_state kc_private.prod_copy_state;
begin
  perform kc_private.require_demo_data_manager();
  select s.* into v_state from kc_private.prod_copy_state s where s.singleton;
  return kc_private.prod_copy_counts() || jsonb_build_object(
    'last_copied_at', v_state.last_copied_at,
    'is_dev_environment', coalesce(v_state.is_dev_environment, false));
end;
$$;
comment on function public.admin_prod_copy_status() is
  'FR-ADMIN-037 AC13: counts of the copied data and the time of the last successful copy.';

-- "Delete copied data": every copied member (with all they own) and organization. Audited with
-- the counts only (AC13). The next weekly copy creates them again.
create or replace function public.admin_delete_prod_copy()
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
  v_out := kc_private.prod_copy_delete_all();
  perform kc_private.audit_record('admin_delete_prod_copy', null, null, v_out, v_actor);
  return v_out;
end;
$$;
comment on function public.admin_delete_prod_copy() is
  'FR-ADMIN-037 AC13: deletes every copied member and organization; audited with counts only.';

-- Functions are private by default (the baseline's default privileges); the portal RPCs are
-- opened to signed-in members, whose rights the bodies check.
revoke all on function public.admin_prod_copy_status() from public, anon;
revoke all on function public.admin_delete_prod_copy() from public, anon;
grant execute on function public.admin_prod_copy_status() to authenticated;
grant execute on function public.admin_delete_prod_copy() to authenticated;
