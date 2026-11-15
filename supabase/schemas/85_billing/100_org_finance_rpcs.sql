-- Billing · the organization's finance screens (requirements/19; Admin Portal finance sub-tree)
--
-- Every function takes the organization and starts with kc_private.finance_assert, so a
-- finance role of one organization never reaches the books of another (FR-FIN-001 AC2).
-- Every write is audited with ids only.
-- Errors: forbidden (42501); P0001 — account_not_found, entry_not_found, invalid_date,
-- invalid_settings, entry_voided, entry_reconciled, entry_locked_by_source,
-- illegal_transition; SQLSTATE 23xxx for a value a column refuses.

-- Accounts of an organization with their balance: opening balance plus cleared income
-- minus cleared expenses (FR-FIN-003 AC1).
create function public.finance_accounts_list(p_org_id uuid)
returns table (id uuid, name text, kind text, last4 text, opening_balance_agorot bigint, opening_balance_at date,
               is_active boolean, sort_order integer, balance_agorot bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform kc_private.finance_assert(p_org_id, 'view');
  return query
  select a.id, a.name, a.kind, a.last4, a.opening_balance_agorot, a.opening_balance_at, a.is_active, a.sort_order,
         (a.opening_balance_agorot + coalesce((
            select sum(case e.direction when 'in' then e.amount_agorot when 'out' then -e.amount_agorot else 0 end)
              from billing.org_finance_entries e
             where e.account_id = a.id and e.status = 'cleared'), 0))::bigint
    from billing.org_finance_accounts a
   where a.org_id = p_org_id
   order by a.is_active desc, a.sort_order, a.name;
end;
$$;
comment on function public.finance_accounts_list(uuid) is 'Finance roles: the accounts of an organization with their balances.';
grant execute on function public.finance_accounts_list(uuid) to authenticated;

-- Creates an account (p_account_id null) or changes one; null leaves a field as it is.
create function public.finance_account_upsert(
  p_org_id uuid,
  p_account_id uuid default null,
  p_name text default null,
  p_kind text default null,
  p_last4 text default null,
  p_opening_balance_agorot bigint default null,
  p_opening_balance_at date default null,
  p_is_active boolean default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.finance_assert(p_org_id, 'manage');
  v_id uuid;
begin
  if p_account_id is null then
    insert into billing.org_finance_accounts (org_id, name, kind, last4, opening_balance_agorot, opening_balance_at,
                                              is_active, created_by)
    values (p_org_id, btrim(p_name), p_kind, p_last4, coalesce(p_opening_balance_agorot, 0), p_opening_balance_at,
            coalesce(p_is_active, true), v_actor)
    returning id into v_id;
  else
    update billing.org_finance_accounts a
       set name = coalesce(btrim(p_name), a.name), kind = coalesce(p_kind, a.kind), last4 = coalesce(p_last4, a.last4),
           opening_balance_agorot = coalesce(p_opening_balance_agorot, a.opening_balance_agorot),
           opening_balance_at = coalesce(p_opening_balance_at, a.opening_balance_at),
           is_active = coalesce(p_is_active, a.is_active)
     where a.id = p_account_id and a.org_id = p_org_id
    returning a.id into v_id;
    if not found then
      raise exception 'account_not_found' using errcode = 'P0001';
    end if;
  end if;
  perform kc_private.audit_record('finance_account_upsert', 'organization', p_org_id,
                                  jsonb_build_object('account_id', v_id));
  return v_id;
end;
$$;
comment on function public.finance_account_upsert(uuid, uuid, text, text, text, bigint, date, boolean) is
  'Finance managers: creates or changes a financial account of an organization.';
grant execute on function public.finance_account_upsert(uuid, uuid, text, text, text, bigint, date, boolean) to authenticated;

-- The books of an organization, newest first. Voided entries are listed only when asked
-- for by status. Keyset: pass occurred_at and id of the last row.
create function public.finance_ledger_list(
  p_org_id uuid,
  p_direction text default null,
  p_status text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_limit integer default 100,
  p_after_occurred_at timestamptz default null,
  p_after_id uuid default null
)
returns table (id uuid, kind text, direction text, amount_agorot bigint, currency text, occurred_at timestamptz,
               account_id uuid, counterparty text, category text, description text, status text,
               void_reason text, is_public boolean, source text, reconciled_at timestamptz,
               created_at timestamptz, updated_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform kc_private.finance_assert(p_org_id, 'view');
  return query
  select e.id, e.kind, e.direction, e.amount_agorot, e.currency, e.occurred_at, e.account_id, e.counterparty,
         e.category, e.description, e.status, e.void_reason, e.is_public, e.source, e.reconciled_at,
         e.created_at, e.updated_at
    from billing.org_finance_entries e
   where e.org_id = p_org_id
     and e.status = coalesce(p_status, case e.status when 'cancelled' then null else e.status end)
     and (p_direction is null or e.direction = p_direction)
     and (p_from is null or e.occurred_at >= p_from)
     and (p_to is null or e.occurred_at <= p_to)
     and (p_after_occurred_at is null or (e.occurred_at, e.id) < (p_after_occurred_at, p_after_id))
   order by e.occurred_at desc, e.id desc
   limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;
comment on function public.finance_ledger_list(uuid, text, text, timestamptz, timestamptz, integer, timestamptz, uuid) is
  'Finance roles: the entries of an organization''s books, newest first (keyset).';
grant execute on function public.finance_ledger_list(uuid, text, text, timestamptz, timestamptz, integer, timestamptz, uuid)
  to authenticated;

-- Creates an entry (p_entry_id null) or changes one; null leaves a field as it is. The
-- date may not lie more than a day ahead (FR-FIN-005 AC1); what a reconciled or mirrored
-- entry may still change is decided by the table's guard.
create function public.finance_ledger_upsert(
  p_org_id uuid,
  p_entry_id uuid default null,
  p_kind text default null,
  p_amount_agorot bigint default null,
  p_occurred_at timestamptz default null,
  p_account_id uuid default null,
  p_counterparty text default null,
  p_category text default null,
  p_description text default null,
  p_status text default null,
  p_is_public boolean default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.finance_assert(p_org_id, 'manage');
  v_id uuid;
begin
  if p_occurred_at > now() + interval '1 day' then
    raise exception 'invalid_date' using errcode = 'P0001';
  end if;
  if p_account_id is not null and not exists (
       select 1 from billing.org_finance_accounts a
        where a.id = p_account_id and a.org_id = p_org_id and a.is_active) then
    raise exception 'account_not_found' using errcode = 'P0001';
  end if;
  if p_entry_id is null then
    insert into billing.org_finance_entries (org_id, kind, amount_agorot, occurred_at, account_id, counterparty,
                                             category, description, status, is_public, created_by)
    values (p_org_id, p_kind, p_amount_agorot, coalesce(p_occurred_at, now()), p_account_id, p_counterparty,
            p_category, p_description, coalesce(p_status, 'pending'), coalesce(p_is_public, true), v_actor)
    returning id into v_id;
  else
    update billing.org_finance_entries e
       set kind = coalesce(p_kind, e.kind), amount_agorot = coalesce(p_amount_agorot, e.amount_agorot),
           occurred_at = coalesce(p_occurred_at, e.occurred_at), account_id = coalesce(p_account_id, e.account_id),
           counterparty = coalesce(p_counterparty, e.counterparty), category = coalesce(p_category, e.category),
           description = coalesce(p_description, e.description), status = coalesce(p_status, e.status),
           is_public = coalesce(p_is_public, e.is_public)
     where e.id = p_entry_id and e.org_id = p_org_id
    returning e.id into v_id;
    if not found then
      raise exception 'entry_not_found' using errcode = 'P0001';
    end if;
  end if;
  perform kc_private.audit_record(
    case when p_entry_id is null then 'finance_entry_create' else 'finance_entry_update' end,
    'organization', p_org_id, jsonb_build_object('entry_id', v_id));
  return v_id;
end;
$$;
comment on function public.finance_ledger_upsert(uuid, uuid, text, bigint, timestamptz, uuid, text, text, text, text, boolean) is
  'Finance managers: creates or changes an entry of an organization''s books.';
grant execute on function public.finance_ledger_upsert(uuid, uuid, text, bigint, timestamptz, uuid, text, text, text, text, boolean)
  to authenticated;

-- Voids an entry with a reason (p_reason given), or marks it reconciled / not reconciled
-- (p_reconciled given). A voided entry stays in the books and counts nowhere.
create function public.finance_ledger_mark(
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
begin
  update billing.org_finance_entries e
     set status = case when p_void_reason is null then e.status else 'cancelled' end,
         void_reason = coalesce(btrim(p_void_reason), e.void_reason),
         reconciled_at = case when p_reconciled is null then e.reconciled_at when p_reconciled then now() end,
         reconciled_by = case when p_reconciled is null then e.reconciled_by when p_reconciled then v_actor end
   where e.id = p_entry_id and e.org_id = p_org_id;
  if not found then
    raise exception 'entry_not_found' using errcode = 'P0001';
  end if;
  perform kc_private.audit_record(
    case when p_void_reason is not null then 'finance_entry_void' else 'finance_reconcile' end,
    'organization', p_org_id, jsonb_build_object('entry_id', p_entry_id, 'reconciled', p_reconciled));
end;
$$;
comment on function public.finance_ledger_mark(uuid, uuid, text, boolean) is
  'Finance managers: voids an entry, or sets or clears its reconciliation.';
grant execute on function public.finance_ledger_mark(uuid, uuid, text, boolean) to authenticated;

-- Switches the public finance blocks of an organization (FR-FIN-022 AC1). p_settings maps
-- block names to booleans; a block that is not named keeps its state.
create function public.finance_transparency_settings_set(p_org_id uuid, p_settings jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform kc_private.finance_assert(p_org_id, 'transparency');
  if jsonb_typeof(p_settings) is distinct from 'object' or exists (
       select 1 from jsonb_each(p_settings) s
        where s.key not in ('show_totals', 'show_donations_count', 'show_program_ratio',
                            'show_category_breakdown', 'show_monthly_trend')
           or jsonb_typeof(s.value) <> 'boolean') then
    raise exception 'invalid_settings' using errcode = 'P0001';
  end if;
  update public.organizations o
     set show_totals = coalesce((p_settings ->> 'show_totals')::boolean, o.show_totals),
         show_donations_count = coalesce((p_settings ->> 'show_donations_count')::boolean, o.show_donations_count),
         show_program_ratio = coalesce((p_settings ->> 'show_program_ratio')::boolean, o.show_program_ratio),
         show_category_breakdown = coalesce((p_settings ->> 'show_category_breakdown')::boolean, o.show_category_breakdown),
         show_monthly_trend = coalesce((p_settings ->> 'show_monthly_trend')::boolean, o.show_monthly_trend)
   where o.id = p_org_id;
  perform kc_private.audit_record('transparency_settings_set', 'organization', p_org_id, p_settings);
end;
$$;
comment on function public.finance_transparency_settings_set(uuid, jsonb) is
  'Organization admins: choose which live finance blocks the public page shows.';
grant execute on function public.finance_transparency_settings_set(uuid, jsonb) to authenticated;

-- Records the Section 46(a) approval of an organization (FR-FIN-007 AC2). `none` and
-- `pending` clear the number and the dates; `active` needs all three (table constraint).
create function public.finance_sec46_set(
  p_org_id uuid,
  p_status text,
  p_approval_number text default null,
  p_valid_from date default null,
  p_valid_until date default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_keep constant boolean := p_status not in ('none', 'pending');
begin
  perform kc_private.finance_assert(p_org_id, 'manage');
  update public.organizations o
     set sec46_status = p_status,
         sec46_approval_number = case when v_keep then p_approval_number end,
         sec46_valid_from = case when v_keep then p_valid_from end,
         sec46_valid_until = case when v_keep then p_valid_until end
   where o.id = p_org_id;
end;
$$;
comment on function public.finance_sec46_set(uuid, text, text, date, date) is
  'Finance managers: records the Section 46(a) approval an organization holds.';
grant execute on function public.finance_sec46_set(uuid, text, text, date, date) to authenticated;
