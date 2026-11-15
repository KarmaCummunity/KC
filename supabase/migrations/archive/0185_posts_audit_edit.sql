-- 0185_posts_audit_edit.sql — TD-109 / FR-POST-008 AC4 (R-MVP-Safety-3).
--
-- Editing a post wrote no audit_event, so an admin reviewing or restoring a
-- post could not see who changed the content or when. audit_events is
-- admin-only-SELECT with no client INSERT policy (writes go through SECURITY
-- DEFINER paths), so the audit is emitted server-side: an AFTER UPDATE trigger
-- logs `post_edited` whenever a signed-in editor changes a FR-POST-008 content
-- column. Status / visibility-only changes (closures, admin removes, D-32
-- visibility) don't touch these columns, so they are not mislabelled as edits.

BEGIN;

-- (1) Extend the action allow-list: v6 (0168) verbatim + `post_edited` → v7.
alter table public.audit_events
  drop constraint if exists audit_events_action_check;
alter table public.audit_events
  add constraint audit_events_action_check_v7 check (action in (
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
    'post_edited'
  )) not valid;
alter table public.audit_events validate constraint audit_events_action_check_v7;
alter table public.audit_events
  rename constraint audit_events_action_check_v7 to audit_events_action_check;

-- (2) Emit `post_edited` on a content change by a signed-in editor.
create or replace function public.posts_after_update_audit_edit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor  uuid := auth.uid();
  v_fields text[] := array[]::text[];
begin
  -- System / internal updates (closures, admin status changes, crons) run
  -- without a JWT — not a user edit.
  if v_actor is null then
    return new;
  end if;

  -- array_append (not `|| 'literal'`) so an unknown-type literal can't resolve
  -- to `anyarray || anyarray` and raise "malformed array literal".
  if new.title                  is distinct from old.title                  then v_fields := array_append(v_fields, 'title'); end if;
  if new.description            is distinct from old.description            then v_fields := array_append(v_fields, 'description'); end if;
  if new.category               is distinct from old.category               then v_fields := array_append(v_fields, 'category'); end if;
  if new.item_condition         is distinct from old.item_condition         then v_fields := array_append(v_fields, 'item_condition'); end if;
  if new.urgency                is distinct from old.urgency                then v_fields := array_append(v_fields, 'urgency'); end if;
  if new.location_display_level is distinct from old.location_display_level then v_fields := array_append(v_fields, 'location_display_level'); end if;
  if new.city                   is distinct from old.city                   then v_fields := array_append(v_fields, 'city'); end if;
  if new.street                 is distinct from old.street                 then v_fields := array_append(v_fields, 'street'); end if;
  if new.street_number          is distinct from old.street_number          then v_fields := array_append(v_fields, 'street_number'); end if;

  -- No FR-POST-008 content column changed (status / visibility-only update).
  if array_length(v_fields, 1) is null then
    return new;
  end if;

  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (v_actor, 'post_edited', 'post', new.post_id, jsonb_build_object('fields', to_jsonb(v_fields)));

  return new;
end;
$$;

drop trigger if exists posts_after_update_audit_edit on public.posts;
create trigger posts_after_update_audit_edit
  after update on public.posts
  for each row
  execute function public.posts_after_update_audit_edit();

COMMIT;
