-- Organizations and billing · page slug change and the reason of a voided entry
-- (FR-ORG-001 AC5, FR-FIN-005; PM decisions recorded in docs/spec/90_decisions_log.md)
--
-- Two PM decisions:
--   • An organization's page slug (the stable part of its public link) changes only by the
--     super admin. The slug column has no client write grant, so this function is the only
--     way to change it.
--   • Voiding an entry of the books (the "delete" of the finance screens) needs the
--     admin's reason. The reason column already holds 3 to 500 characters; the function now
--     refuses a blank or too short reason with its own error instead of a constraint error.

-- Gives an organization a new page slug (super admin only; forbidden, 42501). The slug is
-- trimmed and lower-cased, and must follow the slug rule (invalid_slug) and be free
-- (slug_taken); an unknown organization is org_not_found. Returns the slug; the change is
-- audited with the previous slug.
create function public.admin_set_org_slug(p_org_id uuid, p_slug text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.require_admin_role('super_admin');
  v_slug constant text := lower(btrim(coalesce(p_slug, '')));
  v_previous text;
begin
  select o.slug into v_previous from public.organizations o where o.id = p_org_id for update;
  if not found then
    raise exception 'org_not_found' using errcode = 'P0001';
  end if;
  if v_slug !~ '^[a-z0-9]+(-[a-z0-9]+){0,9}$' or char_length(v_slug) > 60 then
    raise exception 'invalid_slug' using errcode = 'P0001';
  end if;
  if v_slug = v_previous then
    return v_slug;
  end if;
  begin
    update public.organizations o set slug = v_slug where o.id = p_org_id;
  exception when unique_violation then
    raise exception 'slug_taken' using errcode = 'P0001';
  end;
  perform kc_private.audit_record('org_slug_changed', 'organization', p_org_id,
                                  jsonb_build_object('slug', v_slug, 'previous_slug', v_previous), v_actor);
  return v_slug;
end;
$$;
comment on function public.admin_set_org_slug(uuid, text) is
  'Super admin: changes the page slug of an organization; returns the new slug.';
grant execute on function public.admin_set_org_slug(uuid, text) to authenticated;

-- Voids an entry with the admin's reason (p_void_reason given), or marks it reconciled /
-- not reconciled (p_reconciled given). A void needs a reason of 3 to 500 characters after
-- trimming (void_reason_required). A voided entry stays in the books and counts nowhere.
create or replace function public.finance_ledger_mark(
  p_org_id uuid,
  p_entry_id uuid,
  p_void_reason text default null,
  p_reconciled boolean default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.finance_assert(p_org_id, 'manage');
  v_reason constant text := btrim(p_void_reason);
begin
  if p_void_reason is not null and char_length(v_reason) not between 3 and 500 then
    raise exception 'void_reason_required' using errcode = 'P0001';
  end if;
  update billing.org_finance_entries e
     set status = case when v_reason is null then e.status else 'cancelled' end,
         void_reason = coalesce(v_reason, e.void_reason),
         reconciled_at = case when p_reconciled is null then e.reconciled_at when p_reconciled then now() end,
         reconciled_by = case when p_reconciled is null then e.reconciled_by when p_reconciled then v_actor end
   where e.id = p_entry_id and e.org_id = p_org_id;
  if not found then
    raise exception 'entry_not_found' using errcode = 'P0001';
  end if;
  perform kc_private.audit_record(
    case when v_reason is not null then 'finance_entry_void' else 'finance_reconcile' end,
    'organization', p_org_id, jsonb_build_object('entry_id', p_entry_id, 'reconciled', p_reconciled));
end;
$$;
