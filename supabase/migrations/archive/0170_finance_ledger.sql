-- 0170_finance_ledger — V2-ADMIN-MONEY-9 — foundation for V2 §13.3 Admin Money.
--
-- Single-table accounting ledger. Amounts in minor units (cents/agorot); the
-- mobile UI formats by currency. Five movement kinds:
--   donation_in / grant_in   — money received
--   expense / refund_out     — money paid out
--   transfer                  — internal reclassification, signed by `direction`
--
-- The org accounting world (allocated budgets, multi-account books, reports
-- by org) is out of scope here — this is the minimum admins need to record
-- the flows already happening through donation-link buttons or external
-- wires.

create table if not exists public.finance_ledger_entries (
  entry_id      uuid primary key default gen_random_uuid(),
  kind          text not null
                  check (kind in ('donation_in','grant_in','expense','refund_out','transfer')),
  direction     text not null
                  check (direction in ('in','out')),
  amount_cents  bigint not null check (amount_cents >= 0),
  currency      text not null default 'ILS' check (char_length(currency) = 3),
  occurred_at   timestamptz not null default now(),
  counterparty  text check (counterparty is null or char_length(counterparty) <= 200),
  category      text check (category is null or char_length(category) <= 64),
  description   text check (description is null or char_length(description) <= 2000),
  reference_url text check (reference_url is null or char_length(reference_url) <= 2000),
  status        text not null default 'cleared'
                  check (status in ('pending','cleared','canceled')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.users(user_id) on delete set null,
  updated_by    uuid references public.users(user_id) on delete set null,
  deleted_at    timestamptz
);

create index if not exists finance_ledger_occurred_idx
  on public.finance_ledger_entries (occurred_at desc) where deleted_at is null;

create index if not exists finance_ledger_kind_idx
  on public.finance_ledger_entries (kind, occurred_at desc) where deleted_at is null;

comment on table public.finance_ledger_entries is
  'V2-ADMIN-MONEY-9 — minimal donations/expenses ledger. Amounts in minor units; soft-delete via deleted_at.';

alter table public.finance_ledger_entries enable row level security;

drop policy if exists finance_ledger_select_admin on public.finance_ledger_entries;
create policy finance_ledger_select_admin
  on public.finance_ledger_entries for select to authenticated
  using (
    public.has_admin_role(auth.uid(), 'super_admin')
    or public.has_admin_role(auth.uid(), 'moderator')
  );

revoke insert, update, delete on public.finance_ledger_entries from anon, authenticated;
grant select on public.finance_ledger_entries to authenticated;

create or replace function public.finance_ledger_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

drop trigger if exists finance_ledger_before_update_set_updated_at on public.finance_ledger_entries;
create trigger finance_ledger_before_update_set_updated_at
  before update on public.finance_ledger_entries
  for each row execute function public.finance_ledger_set_updated_at();

-- ── 1. list ────────────────────────────────────────────────────────────────
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
  total_count   bigint
)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
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
   where e.deleted_at is null
     and (p_direction is null or e.direction = p_direction)
     and (p_kind      is null or e.kind      = p_kind)
     and (p_status    is null or e.status    = p_status)
     and (p_from      is null or e.occurred_at >= p_from)
     and (p_to        is null or e.occurred_at <= p_to);

  return query
  select
    e.entry_id, e.kind, e.direction, e.amount_cents, e.currency, e.occurred_at,
    e.counterparty, e.category, e.description, e.reference_url, e.status,
    e.created_at, e.updated_at, v_total as total_count
  from public.finance_ledger_entries e
  where e.deleted_at is null
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

-- ── 2. summary ─────────────────────────────────────────────────────────────
create or replace function public.finance_ledger_summary(
  p_from timestamptz default null,
  p_to   timestamptz default null
)
returns table (
  currency        text,
  income_cents    bigint,
  expense_cents   bigint,
  net_cents       bigint,
  entry_count     bigint
)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  perform admin_assert_role(v_actor, array['super_admin','moderator']);

  return query
  select
    e.currency,
    coalesce(sum(case when e.direction = 'in'  then e.amount_cents end), 0)::bigint as income_cents,
    coalesce(sum(case when e.direction = 'out' then e.amount_cents end), 0)::bigint as expense_cents,
    coalesce(sum(case when e.direction = 'in'  then e.amount_cents else 0 end), 0)::bigint
      - coalesce(sum(case when e.direction = 'out' then e.amount_cents else 0 end), 0)::bigint as net_cents,
    count(*)::bigint as entry_count
  from public.finance_ledger_entries e
  where e.deleted_at is null
    and e.status = 'cleared'
    and (p_from is null or e.occurred_at >= p_from)
    and (p_to   is null or e.occurred_at <= p_to)
  group by e.currency
  order by e.currency;
end;
$$;
revoke execute on function public.finance_ledger_summary(timestamptz, timestamptz) from public;
grant  execute on function public.finance_ledger_summary(timestamptz, timestamptz) to authenticated;

-- ── 3. upsert ──────────────────────────────────────────────────────────────
create or replace function public.finance_ledger_upsert(
  p_entry_id     uuid default null,
  p_kind         text default null,
  p_amount_cents bigint default null,
  p_currency     text default null,
  p_occurred_at  timestamptz default null,
  p_counterparty text default null,
  p_category     text default null,
  p_description  text default null,
  p_reference_url text default null,
  p_status       text default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
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

  if p_entry_id is null then
    if p_kind is null or p_amount_cents is null or v_dir is null then
      raise exception 'missing_required_fields' using errcode = '22023';
    end if;
    insert into public.finance_ledger_entries (
      kind, direction, amount_cents, currency, occurred_at,
      counterparty, category, description, reference_url, status,
      created_by, updated_by
    ) values (
      p_kind, v_dir, p_amount_cents,
      coalesce(nullif(p_currency, ''), 'ILS'),
      coalesce(p_occurred_at, now()),
      nullif(btrim(coalesce(p_counterparty, '')), ''),
      nullif(btrim(coalesce(p_category, '')), ''),
      nullif(btrim(coalesce(p_description, '')), ''),
      nullif(btrim(coalesce(p_reference_url, '')), ''),
      coalesce(p_status, 'cleared'),
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
           updated_by   = v_actor
     where entry_id = p_entry_id and deleted_at is null
     returning entry_id into v_id;
    if v_id is null then
      raise exception 'entry_not_found' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$$;
revoke execute on function public.finance_ledger_upsert(uuid, text, bigint, text, timestamptz, text, text, text, text, text) from public;
grant  execute on function public.finance_ledger_upsert(uuid, text, bigint, text, timestamptz, text, text, text, text, text) to authenticated;

-- ── 4. soft delete ─────────────────────────────────────────────────────────
create or replace function public.finance_ledger_delete(p_entry_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_id    uuid;
begin
  perform admin_assert_role(v_actor, array['super_admin','moderator']);
  update public.finance_ledger_entries
     set deleted_at = now(), updated_by = v_actor
   where entry_id = p_entry_id and deleted_at is null
   returning entry_id into v_id;
  if v_id is null then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;
end;
$$;
revoke execute on function public.finance_ledger_delete(uuid) from public;
grant  execute on function public.finance_ledger_delete(uuid) to authenticated;
