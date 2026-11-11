-- 0270_payment_ledger_webhooks | Issue #850 (part 4)
-- Double-entry ledger + provider webhook inbox (idempotent).

begin;

create table public.payment_ledger_entries (
  entry_id         uuid primary key default gen_random_uuid(),
  txn_id           uuid not null,
  account_code     text not null,
  debit_ils        numeric(14, 2) not null default 0 check (debit_ils >= 0),
  credit_ils       numeric(14, 2) not null default 0 check (credit_ils >= 0),
  currency         text not null default 'ILS',
  idempotency_key  text not null,
  ref_type         text,
  ref_id           uuid,
  created_at       timestamptz not null default now(),
  constraint payment_ledger_side check (not (debit_ils > 0 and credit_ils > 0)),
  constraint payment_ledger_line_unique unique (txn_id, account_code, idempotency_key)
);

create index payment_ledger_txn_idx on public.payment_ledger_entries (txn_id);

create table public.provider_webhook_events (
  webhook_event_id   uuid primary key default gen_random_uuid(),
  provider_slug      text not null,
  provider_event_id  text not null,
  payload            jsonb not null,
  status             text not null default 'pending'
    check (status in ('pending','processed','failed')),
  processed_at       timestamptz,
  error_message      text,
  created_at         timestamptz not null default now(),
  constraint provider_webhook_events_dedupe unique (provider_slug, provider_event_id)
);

alter table public.payment_ledger_entries enable row level security;
alter table public.provider_webhook_events enable row level security;

create policy payment_ledger_operator_read on public.payment_ledger_entries
  for select to authenticated using (public.is_listing_operator(auth.uid()));

revoke all on public.provider_webhook_events from authenticated, anon;
-- Raw provider payloads: service_role (webhook edge function) only.
create policy provider_webhook_events_service_read on public.provider_webhook_events
  for select to service_role using (true);

create or replace function public.payment_ledger_post_balanced(
  p_txn_id uuid,
  p_lines jsonb,
  p_idempotency_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_debit numeric;
  v_credit numeric;
  v_line jsonb;
begin
  if p_idempotency_key is null or p_txn_id is null then
    raise exception 'invalid_ledger_post' using errcode = '22023';
  end if;

  select
    coalesce(sum((l->>'debit')::numeric), 0),
    coalesce(sum((l->>'credit')::numeric), 0)
  into v_debit, v_credit
  from jsonb_array_elements(p_lines) l;

  if v_debit <> v_credit then
    raise exception 'ledger_unbalanced' using errcode = '23514';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    insert into public.payment_ledger_entries (
      txn_id, account_code, debit_ils, credit_ils, idempotency_key, ref_type, ref_id
    ) values (
      p_txn_id,
      v_line->>'account',
      coalesce((v_line->>'debit')::numeric, 0),
      coalesce((v_line->>'credit')::numeric, 0),
      p_idempotency_key,
      v_line->>'ref_type',
      nullif(v_line->>'ref_id', '')::uuid
    )
    on conflict on constraint payment_ledger_line_unique do nothing;
  end loop;
end;
$$;

create or replace function public.provider_webhook_apply(p_provider_slug text, p_event_id text, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.provider_webhook_events (provider_slug, provider_event_id, payload, status)
  values (p_provider_slug, p_event_id, p_payload, 'pending')
  on conflict (provider_slug, provider_event_id) do nothing
  returning webhook_event_id into v_id;

  if v_id is null then
    select webhook_event_id into v_id
      from public.provider_webhook_events
     where provider_slug = p_provider_slug and provider_event_id = p_event_id;
    return v_id;
  end if;

  update public.provider_webhook_events
     set status = 'processed', processed_at = now()
   where webhook_event_id = v_id;

  return v_id;
end;
$$;

grant execute on function public.payment_ledger_post_balanced(uuid, jsonb, text) to service_role;
grant execute on function public.provider_webhook_apply(text, text, jsonb) to service_role;

commit;
