-- 0470_finance_accounts_transparency | FR-FIN-003 (lean), FR-FIN-022, FR-FIN-023
--
-- Lean first slice of the org-finance domain (spec/19_org_finance.md), built on
-- top of the minimal ledger from 0170:
--   1. org_id on every ledger entry (D76: multi-tenant from day one). Existing rows
--      are backfilled to the platform organisation; the RPCs below still operate on
--      the platform org only until FR-FIN-001 introduces `p_org_id`.
--   2. finance_accounts: where the money physically sits (bank, cash, Bit, ...),
--      with a computed balance.
--   3. Ledger entries gain `account_id` and `is_public` (per-entry privacy switch).
--   4. A donors overview (admin only): the ledger grouped by counterparty.
--   5. Live public transparency, controlled by the organisation:
--      `organizations.transparency_settings` toggles + `rpc_org_transparency`, which
--      returns aggregates only (never counterparties, entry ids or account names).
--      Every toggle defaults to OFF, so nothing is exposed until an admin opts in.
--
-- All amounts are minor units (agorot). Writes stay RPC-only (D-194 / ADR-002).

-- ── 0. Platform organisation lookup ────────────────────────────────────────
create or replace function public.finance_platform_org_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select o.org_id from public.organizations o where o.is_platform limit 1;
$$;
-- Internal helper: called only from the SECURITY DEFINER RPCs below (runs as owner),
-- so it is intentionally not granted to client roles. Supabase's default privileges grant
-- EXECUTE to anon/authenticated explicitly, so revoking from PUBLIC alone is not enough.
revoke execute on function public.finance_platform_org_id() from public, anon, authenticated;

-- ── 1. finance_accounts ────────────────────────────────────────────────────
create table if not exists public.finance_accounts (
  account_id            uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations(org_id) on delete restrict,
  name                  text not null check (char_length(btrim(name)) between 1 and 80),
  kind                  text not null
                          check (kind in ('bank','cash','bit','paybox','payment_provider','other')),
  last4                 text check (last4 is null or last4 ~ '^[0-9]{4}$'),
  opening_balance_cents bigint not null default 0,
  opening_balance_at    date,
  is_active             boolean not null default true,
  sort_order            int not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid references public.users(user_id) on delete set null,
  constraint finance_accounts_org_name_uq unique (org_id, name)
);

comment on table public.finance_accounts is
  'FR-FIN-003 — financial accounts (bank, cash, Bit, ...). Deactivate instead of delete; writes via finance_account_upsert only.';

alter table public.finance_accounts enable row level security;

drop policy if exists finance_accounts_select_admin on public.finance_accounts;
create policy finance_accounts_select_admin
  on public.finance_accounts for select to authenticated
  using (
    public.has_admin_role(auth.uid(), 'super_admin')
    or public.has_admin_role(auth.uid(), 'moderator')
  );

revoke insert, update, delete on public.finance_accounts from anon, authenticated;
grant select on public.finance_accounts to authenticated;

drop trigger if exists finance_accounts_before_update_set_updated_at on public.finance_accounts;
create trigger finance_accounts_before_update_set_updated_at
  before update on public.finance_accounts
  for each row execute function public.finance_ledger_set_updated_at();

-- ── 2. Ledger columns: org_id, account_id, is_public ───────────────────────
alter table public.finance_ledger_entries
  add column if not exists org_id     uuid references public.organizations(org_id) on delete restrict,
  add column if not exists account_id uuid references public.finance_accounts(account_id) on delete restrict,
  add column if not exists is_public  boolean not null default true;

-- Backfill: every pre-existing entry belongs to the platform organisation (FR-FIN-001 AC1).
update public.finance_ledger_entries
   set org_id = public.finance_platform_org_id()
 where org_id is null;

alter table public.finance_ledger_entries alter column org_id set not null;

create index if not exists finance_ledger_org_occurred_idx
  on public.finance_ledger_entries (org_id, occurred_at desc) where deleted_at is null;
create index if not exists finance_ledger_account_idx
  on public.finance_ledger_entries (account_id) where account_id is not null;

comment on column public.finance_ledger_entries.is_public is
  'FR-FIN-022 — when false the entry is excluded from the public transparency aggregates.';

-- ── 3. Organisation transparency settings ──────────────────────────────────
-- Allowed keys (all booleans, absent = false): show_totals, show_program_ratio,
-- show_category_breakdown, show_monthly_trend, show_donations_count.
alter table public.organizations
  add column if not exists transparency_settings jsonb not null default '{}'::jsonb;

-- ── 4. Seed default accounts for the platform org (FR-FIN-003 AC3) ─────────
insert into public.finance_accounts (org_id, name, kind, sort_order)
select o.org_id, v.name, v.kind, v.sort_order
  from public.organizations o
 cross join (values ('מזומן', 'cash', 0), ('Bit', 'bit', 1), ('Paybox', 'paybox', 2))
         as v(name, kind, sort_order)
 where o.is_platform
on conflict (org_id, name) do nothing;

-- ── 5. Ledger RPCs: list + upsert gain account_id / is_public ──────────────
-- OUT columns of `list` change, so the function must be dropped first. The upsert
-- gets two new defaulted parameters: drop the old overload so PostgREST never sees
-- an ambiguous pair (named-argument callers keep working against the new one).
drop function if exists public.finance_ledger_list(text, text, text, timestamptz, timestamptz, int, int);
drop function if exists public.finance_ledger_upsert(uuid, text, bigint, text, timestamptz, text, text, text, text, text);

create or replace function public.finance_ledger_list(
  p_direction text default null,
  p_kind      text default null,
  p_status    text default null,
  p_from      timestamptz default null,
  p_to        timestamptz default null,
  p_limit     int default 100,
  p_offset    int default 0
)
returns table (
  entry_id      uuid,
  kind          text,
  direction     text,
  amount_cents  bigint,
  currency      text,
  occurred_at   timestamptz,
  counterparty  text,
  category      text,
  description   text,
  reference_url text,
  status        text,
  created_at    timestamptz,
  updated_at    timestamptz,
  account_id    uuid,
  is_public     boolean,
  total_count   bigint
)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_org   uuid := public.finance_platform_org_id();
  v_lim   int  := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_off   int  := greatest(coalesce(p_offset, 0), 0);
  v_total bigint;
begin
  perform admin_assert_role(v_actor, array['super_admin','moderator']);
  if p_direction is not null and p_direction not in ('in','out') then
    raise exception 'invalid_direction' using errcode = '22023';
  end if;
  if p_status is not null and p_status not in ('pending','cleared','canceled') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  select count(*) into v_total
    from public.finance_ledger_entries e
   where e.org_id = v_org
     and e.deleted_at is null
     and (p_direction is null or e.direction = p_direction)
     and (p_kind      is null or e.kind      = p_kind)
     and (p_status    is null or e.status    = p_status)
     and (p_from      is null or e.occurred_at >= p_from)
     and (p_to        is null or e.occurred_at <= p_to);

  return query
  select
    e.entry_id, e.kind, e.direction, e.amount_cents, e.currency, e.occurred_at,
    e.counterparty, e.category, e.description, e.reference_url, e.status,
    e.created_at, e.updated_at, e.account_id, e.is_public, v_total as total_count
  from public.finance_ledger_entries e
  where e.org_id = v_org
    and e.deleted_at is null
    and (p_direction is null or e.direction = p_direction)
    and (p_kind      is null or e.kind      = p_kind)
    and (p_status    is null or e.status    = p_status)
    and (p_from      is null or e.occurred_at >= p_from)
    and (p_to        is null or e.occurred_at <= p_to)
  order by e.occurred_at desc
  limit v_lim offset v_off;
end;
$$;
revoke execute on function public.finance_ledger_list(text, text, text, timestamptz, timestamptz, int, int) from public;
grant  execute on function public.finance_ledger_list(text, text, text, timestamptz, timestamptz, int, int) to authenticated;

create or replace function public.finance_ledger_upsert(
  p_entry_id      uuid default null,
  p_kind          text default null,
  p_amount_cents  bigint default null,
  p_currency      text default null,
  p_occurred_at   timestamptz default null,
  p_counterparty  text default null,
  p_category      text default null,
  p_description   text default null,
  p_reference_url text default null,
  p_status        text default null,
  p_account_id    uuid default null,
  p_is_public     boolean default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_org   uuid := public.finance_platform_org_id();
  v_id    uuid;
  v_dir   text;
begin
  perform admin_assert_role(v_actor, array['super_admin','moderator']);

  if p_kind is not null then
    if p_kind not in ('donation_in','grant_in','expense','refund_out','transfer') then
      raise exception 'invalid_kind' using errcode = '22023';
    end if;
    v_dir := case
      when p_kind in ('donation_in','grant_in') then 'in'
      when p_kind in ('expense','refund_out')   then 'out'
      else null
    end;
  end if;
  if p_status is not null and p_status not in ('pending','cleared','canceled') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  if p_amount_cents is not null and p_amount_cents < 0 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;
  -- An entry may only reference an active account of its own organisation.
  if p_account_id is not null and not exists (
    select 1 from public.finance_accounts a
     where a.account_id = p_account_id and a.org_id = v_org and a.is_active
  ) then
    raise exception 'account_not_found' using errcode = 'P0002';
  end if;

  if p_entry_id is null then
    if p_kind is null or p_amount_cents is null or v_dir is null then
      raise exception 'missing_required_fields' using errcode = '22023';
    end if;
    insert into public.finance_ledger_entries (
      org_id, kind, direction, amount_cents, currency, occurred_at,
      counterparty, category, description, reference_url, status,
      account_id, is_public, created_by, updated_by
    ) values (
      v_org, p_kind, v_dir, p_amount_cents,
      coalesce(nullif(p_currency, ''), 'ILS'),
      coalesce(p_occurred_at, now()),
      nullif(btrim(coalesce(p_counterparty, '')), ''),
      nullif(btrim(coalesce(p_category, '')), ''),
      nullif(btrim(coalesce(p_description, '')), ''),
      nullif(btrim(coalesce(p_reference_url, '')), ''),
      coalesce(p_status, 'cleared'),
      p_account_id, coalesce(p_is_public, true),
      v_actor, v_actor
    )
    returning entry_id into v_id;
  else
    update public.finance_ledger_entries
       set kind         = coalesce(p_kind, kind),
           direction    = coalesce(v_dir, direction),
           amount_cents = coalesce(p_amount_cents, amount_cents),
           currency     = coalesce(nullif(p_currency, ''), currency),
           occurred_at  = coalesce(p_occurred_at, occurred_at),
           counterparty = case when p_counterparty is not null then nullif(btrim(p_counterparty), '') else counterparty end,
           category     = case when p_category     is not null then nullif(btrim(p_category), '')     else category end,
           description  = case when p_description  is not null then nullif(btrim(p_description), '')  else description end,
           reference_url= case when p_reference_url is not null then nullif(btrim(p_reference_url), '') else reference_url end,
           status       = coalesce(p_status, status),
           account_id   = coalesce(p_account_id, account_id),
           is_public    = coalesce(p_is_public, is_public),
           updated_by   = v_actor
     where entry_id = p_entry_id and org_id = v_org and deleted_at is null
     returning entry_id into v_id;
    if v_id is null then
      raise exception 'entry_not_found' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$$;
revoke execute on function public.finance_ledger_upsert(uuid, text, bigint, text, timestamptz, text, text, text, text, text, uuid, boolean) from public;
grant  execute on function public.finance_ledger_upsert(uuid, text, bigint, text, timestamptz, text, text, text, text, text, uuid, boolean) to authenticated;

-- ── 6. Accounts RPCs ───────────────────────────────────────────────────────
-- balance = opening balance + cleared inflows - cleared outflows (ILS entries only).
create or replace function public.finance_accounts_list()
returns table (
  account_id            uuid,
  name                  text,
  kind                  text,
  last4                 text,
  opening_balance_cents bigint,
  opening_balance_at    date,
  is_active             boolean,
  sort_order            int,
  balance_cents         bigint,
  entry_count           bigint
)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_org uuid := public.finance_platform_org_id();
begin
  perform admin_assert_role(auth.uid(), array['super_admin','moderator']);

  return query
  select
    a.account_id, a.name, a.kind, a.last4, a.opening_balance_cents, a.opening_balance_at,
    a.is_active, a.sort_order,
    (a.opening_balance_cents + coalesce(sum(
        case when e.status = 'cleared' and e.currency = 'ILS' then
          case e.direction when 'in' then e.amount_cents else -e.amount_cents end
        end), 0))::bigint as balance_cents,
    count(e.entry_id)::bigint as entry_count
  from public.finance_accounts a
  left join public.finance_ledger_entries e
         on e.account_id = a.account_id and e.deleted_at is null
  where a.org_id = v_org
  group by a.account_id
  order by a.is_active desc, a.sort_order, a.name;
end;
$$;
revoke execute on function public.finance_accounts_list() from public;
grant  execute on function public.finance_accounts_list() to authenticated;

create or replace function public.finance_account_upsert(
  p_account_id            uuid default null,
  p_name                  text default null,
  p_kind                  text default null,
  p_last4                 text default null,
  p_opening_balance_cents bigint default null,
  p_opening_balance_at    date default null,
  p_is_active             boolean default null,
  p_sort_order            int default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_org   uuid := public.finance_platform_org_id();
  v_name  text := nullif(btrim(coalesce(p_name, '')), '');
  v_id    uuid;
begin
  perform admin_assert_role(v_actor, array['super_admin','moderator']);

  if p_kind is not null
     and p_kind not in ('bank','cash','bit','paybox','payment_provider','other') then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;
  if p_last4 is not null and p_last4 <> '' and p_last4 !~ '^[0-9]{4}$' then
    raise exception 'invalid_last4' using errcode = '22023';
  end if;
  if p_name is not null and (v_name is null or char_length(v_name) > 80) then
    raise exception 'invalid_name' using errcode = '22023';
  end if;

  begin
    if p_account_id is null then
      if v_name is null or p_kind is null then
        raise exception 'missing_required_fields' using errcode = '22023';
      end if;
      insert into public.finance_accounts (
        org_id, name, kind, last4, opening_balance_cents, opening_balance_at,
        is_active, sort_order, created_by
      ) values (
        v_org, v_name, p_kind, nullif(p_last4, ''),
        coalesce(p_opening_balance_cents, 0), p_opening_balance_at,
        coalesce(p_is_active, true), coalesce(p_sort_order, 0), v_actor
      )
      returning account_id into v_id;
    else
      update public.finance_accounts
         set name       = coalesce(v_name, name),
             kind       = coalesce(p_kind, kind),
             last4      = case when p_last4 is not null then nullif(p_last4, '') else last4 end,
             opening_balance_cents = coalesce(p_opening_balance_cents, opening_balance_cents),
             opening_balance_at    = coalesce(p_opening_balance_at, opening_balance_at),
             is_active  = coalesce(p_is_active, is_active),
             sort_order = coalesce(p_sort_order, sort_order)
       where account_id = p_account_id and org_id = v_org
       returning account_id into v_id;
      if v_id is null then
        raise exception 'account_not_found' using errcode = 'P0002';
      end if;
    end if;
  exception when unique_violation then
    raise exception 'account_name_taken' using errcode = '23505';
  end;
  return v_id;
end;
$$;
revoke execute on function public.finance_account_upsert(uuid, text, text, text, bigint, date, boolean, int) from public;
grant  execute on function public.finance_account_upsert(uuid, text, text, text, bigint, date, boolean, int) to authenticated;

-- ── 7. Donors overview (admin only) ────────────────────────────────────────
-- Groups cleared donation / grant entries by counterparty (case-insensitive).
-- Entries without a counterparty are returned as one row with a NULL name
-- (the UI labels it "anonymous").
create or replace function public.finance_donors_summary(p_limit int default 200)
returns table (
  donor_name      text,
  donations_count bigint,
  total_cents     bigint,
  first_at        timestamptz,
  last_at         timestamptz
)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_org uuid := public.finance_platform_org_id();
  v_lim int  := least(greatest(coalesce(p_limit, 200), 1), 500);
begin
  perform admin_assert_role(auth.uid(), array['super_admin','moderator']);

  return query
  select
    -- Most recently typed spelling represents the group.
    (array_agg(e.counterparty order by e.occurred_at desc))[1] as donor_name,
    count(*)::bigint,
    sum(e.amount_cents)::bigint,
    min(e.occurred_at),
    max(e.occurred_at)
  from public.finance_ledger_entries e
  where e.org_id = v_org
    and e.deleted_at is null
    and e.status = 'cleared'
    and e.currency = 'ILS'
    and e.kind in ('donation_in','grant_in')
  group by lower(btrim(coalesce(e.counterparty, '')))
  -- Ordered by the aggregate itself: an output-column alias would clash with the
  -- plpgsql OUT variable of the same name.
  order by sum(e.amount_cents) desc
  limit v_lim;
end;
$$;
revoke execute on function public.finance_donors_summary(int) from public;
grant  execute on function public.finance_donors_summary(int) to authenticated;

-- ── 8. Transparency settings (admin) ───────────────────────────────────────
create or replace function public.finance_transparency_settings_get()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  perform admin_assert_role(auth.uid(), array['super_admin','moderator']);
  return coalesce(
    (select o.transparency_settings from public.organizations o where o.is_platform limit 1),
    '{}'::jsonb
  );
end;
$$;
revoke execute on function public.finance_transparency_settings_get() from public;
grant  execute on function public.finance_transparency_settings_get() to authenticated;

-- Publishing decisions belong to super admins only. Unknown keys and non-boolean
-- values are rejected so the public RPC never has to defend against junk.
create or replace function public.finance_transparency_settings_set(p_settings jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_allowed constant text[] := array[
    'show_totals','show_program_ratio','show_category_breakdown',
    'show_monthly_trend','show_donations_count'
  ];
  v_key text;
  v_val jsonb;
  v_new jsonb;
begin
  perform admin_assert_role(auth.uid(), array['super_admin']);

  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    raise exception 'invalid_settings' using errcode = '22023';
  end if;
  for v_key, v_val in select * from jsonb_each(p_settings) loop
    if not (v_key = any (v_allowed)) or jsonb_typeof(v_val) <> 'boolean' then
      raise exception 'invalid_settings' using errcode = '22023';
    end if;
  end loop;

  update public.organizations o
     set transparency_settings = o.transparency_settings || p_settings
   where o.is_platform
   returning o.transparency_settings into v_new;
  if v_new is null then
    raise exception 'org_not_found' using errcode = 'P0002';
  end if;
  return v_new;
end;
$$;
revoke execute on function public.finance_transparency_settings_set(jsonb) from public;
grant  execute on function public.finance_transparency_settings_set(jsonb) to authenticated;

-- ── 9. Public live transparency ────────────────────────────────────────────
-- Aggregates only. Included entries: cleared, not deleted, ILS, `is_public`, and
-- not internal transfers. A block is present in the result only when the matching
-- toggle is on; with every toggle off the result is just {"enabled": false}.
-- Expense-category keys below mirror FINANCE_EXPENSE_CATEGORIES in @kc/domain;
-- any other free-text category is folded into 'other_out'.
create or replace function public.rpc_org_transparency(p_slug text default null)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_org      public.organizations%rowtype;
  v_cfg      jsonb;
  v_result   jsonb;
  v_income   bigint;
  v_expense  bigint;
  v_program  bigint;
  v_count    bigint;
  v_last     timestamptz;
  v_known    constant text[] := array[
    'program','payroll','rent_ops','marketing_fundraising',
    'admin_general','fees','donor_refunds','other_out'
  ];
begin
  select * into v_org from public.organizations o
   where (p_slug is null and o.is_platform) or (p_slug is not null and o.slug = p_slug)
   limit 1;
  if not found then
    return jsonb_build_object('enabled', false);
  end if;

  v_cfg := coalesce(v_org.transparency_settings, '{}'::jsonb);
  if not (
    coalesce((v_cfg->>'show_totals')::boolean, false)
    or coalesce((v_cfg->>'show_program_ratio')::boolean, false)
    or coalesce((v_cfg->>'show_category_breakdown')::boolean, false)
    or coalesce((v_cfg->>'show_monthly_trend')::boolean, false)
    or coalesce((v_cfg->>'show_donations_count')::boolean, false)
  ) then
    return jsonb_build_object('enabled', false);
  end if;

  select
    coalesce(sum(e.amount_cents) filter (where e.direction = 'in'), 0),
    coalesce(sum(e.amount_cents) filter (where e.direction = 'out'), 0),
    coalesce(sum(e.amount_cents) filter (where e.direction = 'out' and e.category = 'program'), 0),
    count(*) filter (where e.kind in ('donation_in','grant_in')),
    max(e.occurred_at)
    into v_income, v_expense, v_program, v_count, v_last
  from public.finance_ledger_entries e
  where e.org_id = v_org.org_id
    and e.deleted_at is null and e.status = 'cleared' and e.currency = 'ILS'
    and e.is_public and e.kind <> 'transfer';

  v_result := jsonb_build_object('enabled', true, 'currency', 'ILS', 'last_entry_at', v_last);

  if coalesce((v_cfg->>'show_totals')::boolean, false) then
    v_result := v_result || jsonb_build_object(
      'income_cents', v_income, 'expense_cents', v_expense, 'net_cents', v_income - v_expense);
  end if;

  if coalesce((v_cfg->>'show_donations_count')::boolean, false) then
    v_result := v_result || jsonb_build_object('donations_count', v_count);
  end if;

  if coalesce((v_cfg->>'show_program_ratio')::boolean, false) and v_expense > 0 then
    v_result := v_result || jsonb_build_object(
      'program_ratio', round(v_program::numeric / v_expense::numeric, 4));
  end if;

  if coalesce((v_cfg->>'show_category_breakdown')::boolean, false) then
    v_result := v_result || jsonb_build_object('by_category', coalesce((
      select jsonb_agg(jsonb_build_object('key', c.k, 'cents', c.cents) order by c.cents desc)
        from (
          select case when e.category = any (v_known) then e.category else 'other_out' end as k,
                 sum(e.amount_cents)::bigint as cents
            from public.finance_ledger_entries e
           where e.org_id = v_org.org_id
             and e.deleted_at is null and e.status = 'cleared' and e.currency = 'ILS'
             and e.is_public and e.direction = 'out' and e.kind <> 'transfer'
           group by 1
        ) c
    ), '[]'::jsonb));
  end if;

  if coalesce((v_cfg->>'show_monthly_trend')::boolean, false) then
    v_result := v_result || jsonb_build_object('monthly', (
      select jsonb_agg(jsonb_build_object(
               'month', to_char(m.month, 'YYYY-MM'),
               'income_cents', coalesce(s.income, 0),
               'expense_cents', coalesce(s.expense, 0)) order by m.month)
        from generate_series(
               date_trunc('month', now()) - interval '11 months',
               date_trunc('month', now()), interval '1 month') as m(month)
        left join (
          select date_trunc('month', e.occurred_at) as month,
                 (sum(e.amount_cents) filter (where e.direction = 'in'))::bigint  as income,
                 (sum(e.amount_cents) filter (where e.direction = 'out'))::bigint as expense
            from public.finance_ledger_entries e
           where e.org_id = v_org.org_id
             and e.deleted_at is null and e.status = 'cleared' and e.currency = 'ILS'
             and e.is_public and e.kind <> 'transfer'
           group by 1
        ) s on s.month = m.month
    ));
  end if;

  return v_result;
end;
$$;
revoke execute on function public.rpc_org_transparency(text) from public;
grant  execute on function public.rpc_org_transparency(text) to anon, authenticated;
