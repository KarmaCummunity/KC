-- Billing · provider events and the service-role entry points
--
-- The Edge Functions (`payments-webhook`, `subscriptions-charger`) run as the service role
-- and call the functions of this file by name; no client role may execute them. The
-- webhook function verifies the provider's signature and hands over a normalized event:
--   { "type": "payment.succeeded" | "payment.failed",   "intent_id", "provider_ref", "amount_agorot"? }
--   { "type": "refund.succeeded" | "refund.failed",     "refund_id", "provider_ref"? }
--   { "type": "payout.succeeded" | "payout.failed",     "payout_id", "provider_ref"? }
--   { "type": "standing_order.activated",               "standing_order_id", "provider_ref" }
--   { "type": "kyc.updated", "party_type": "payer" | "recipient", "party_id", "status", "provider_ref"? }

-- Stores a provider event and applies it, once. A repeated event returns its stored outcome
-- and does nothing; an event that cannot be applied is kept as `failed` with its error
-- code, changes nothing else, and is applied again when the provider resends it. The caller
-- gets the outcome (`processed` or `failed` plus the code) so the webhook can answer the
-- provider with an error status and make it resend.
create function public.provider_webhook_apply(p_provider_slug text, p_event_id text, p_payload jsonb)
returns table (webhook_event_id uuid, event_status text, event_error_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event billing.webhook_events;
  v_type constant text := p_payload ->> 'type';
  v_ok constant boolean := v_type like '%.succeeded';
  v_ref constant text := p_payload ->> 'provider_ref';
  v_error text;
begin
  insert into billing.webhook_events (provider_slug, provider_event_id, event_type, payload)
  values (p_provider_slug, p_event_id, v_type, p_payload)
  on conflict (provider_slug, provider_event_id) do nothing
  returning * into v_event;
  if not found then
    select e.* into strict v_event from billing.webhook_events e
     where e.provider_slug = p_provider_slug and e.provider_event_id = p_event_id for update;
    if v_event.status = 'processed' then
      return query select v_event.id, v_event.status, v_event.error_code;
      return;
    end if;
  end if;

  begin
    case
      when v_type in ('payment.succeeded', 'payment.failed') then
        -- A provider settles only the intents that were sent to it.
        if not exists (select 1 from billing.donation_intents i
                         join billing.payment_providers p on p.id = i.provider_id
                        where i.id = (p_payload ->> 'intent_id')::uuid and p.slug = p_provider_slug) then
          raise exception 'intent_not_found' using errcode = 'P0001';
        end if;
        perform kc_private.billing_payment_settle(
          (p_payload ->> 'intent_id')::uuid, v_ok, p_provider_slug || ':' || p_event_id, v_ref,
          (p_payload ->> 'amount_agorot')::bigint);
      when v_type in ('refund.succeeded', 'refund.failed') then
        perform kc_private.billing_refund_settle((p_payload ->> 'refund_id')::uuid, v_ok, v_ref);
      when v_type in ('payout.succeeded', 'payout.failed') then
        perform kc_private.billing_payout_settle((p_payload ->> 'payout_id')::uuid, v_ok, v_ref);
      when v_type = 'standing_order.activated' then
        perform kc_private.billing_standing_order_activate((p_payload ->> 'standing_order_id')::uuid, v_ref);
      when v_type = 'kyc.updated' then
        perform kc_private.billing_kyc_set(p_payload ->> 'party_type', (p_payload ->> 'party_id')::uuid,
                                           p_payload ->> 'status', v_ref);
      else
        raise exception 'unknown_event_type' using errcode = 'P0001';
    end case;
  exception when others then
    -- Everything the event did is rolled back; only its failure is recorded.
    v_error := case sqlstate when 'P0001' then sqlerrm else sqlstate end;
  end;

  update billing.webhook_events e
     set status = case when v_error is null then 'processed' else 'failed' end,
         processed_at = case when v_error is null then now() end,
         error_code = v_error
   where e.id = v_event.id;
  return query select v_event.id, case when v_error is null then 'processed' else 'failed' end, v_error;
end;
$$;
comment on function public.provider_webhook_apply(text, text, jsonb) is
  'Service role: stores and applies a provider event exactly once; returns the stored event id with its outcome (processed or failed and the error code).';

-- The checkout session the provider opened for an intent: the donor is sent to its page.
-- Errors: P0001 intent_not_found (no such intent waiting for a checkout).
create function public.api_donation_intent_set_checkout(p_intent_id uuid, p_provider_ref text, p_checkout_url text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update billing.donation_intents i
     set status = 'checkout', provider_ref = p_provider_ref, checkout_url = p_checkout_url
   where i.id = p_intent_id and i.status = 'created';
  if not found then
    raise exception 'intent_not_found' using errcode = 'P0001';
  end if;
end;
$$;
comment on function public.api_donation_intent_set_checkout(uuid, text, text) is
  'Service role: records the provider checkout session of a donation intent.';

-- Opens the charge of every active standing order that is due and moves each order to
-- its next date. Returns the intents to charge at the provider; the outcome of each
-- arrives as a provider event. Concurrent runs never take the same order, and an order's
-- period is charged once (the intent's idempotency key names the order and the due date).
create function public.api_standing_orders_charge_due(p_limit integer default 20)
returns table (intent_id uuid, standing_order_id uuid, amount_agorot bigint, mandate_ref text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order billing.standing_orders;
begin
  for v_order in
    select o.* from billing.standing_orders o
     where o.status = 'active' and o.next_charge_at <= now()
     order by o.next_charge_at
     limit least(greatest(coalesce(p_limit, 20), 1), 200)
       for update skip locked
  loop
    insert into billing.donation_intents as i (user_id, user_tombstone, org_id, standing_order_id, amount_agorot,
                                               currency, status, provider_id, idempotency_key)
    values (v_order.user_id, v_order.user_tombstone, v_order.org_id, v_order.id, v_order.amount_agorot,
            v_order.currency, 'checkout', v_order.provider_id,
            'standing_order:' || v_order.id || ':' || to_char(v_order.next_charge_at at time zone 'UTC', 'YYYY-MM-DD'))
    on conflict (idempotency_key) do nothing
    returning i.id into intent_id;
    update billing.standing_orders o
       set next_charge_at = o.next_charge_at + case o.cadence when 'monthly' then interval '1 month'
                                                               when 'quarterly' then interval '3 months'
                                                               else interval '1 year' end
     where o.id = v_order.id;
    if intent_id is not null then
      standing_order_id := v_order.id;
      amount_agorot := v_order.amount_agorot;
      mandate_ref := v_order.provider_ref;
      return next;
    end if;
  end loop;
end;
$$;
comment on function public.api_standing_orders_charge_due(integer) is
  'Service role: opens the due charges of active standing orders and returns them for the provider.';

-- Opens a payout of what the product holds for an organization. The amount may not
-- exceed the organization's ledger balance less its payouts already on the way. The same
-- idempotency key returns the same payout.
-- Errors: P0001 insufficient_balance.
create function public.api_payout_open(p_org_id uuid, p_amount_agorot bigint, p_idempotency_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payout_id uuid;
begin
  -- One payout decision per organization at a time.
  perform pg_advisory_xact_lock(hashtextextended('billing.payout:' || p_org_id, 0));
  select p.id into v_payout_id from billing.payouts p where p.idempotency_key = p_idempotency_key;
  if found then
    return v_payout_id;
  end if;
  if p_amount_agorot > kc_private.billing_org_balance(p_org_id)
       - coalesce((select sum(p.amount_agorot) from billing.payouts p
                    where p.org_id = p_org_id and p.status = 'pending'), 0) then
    raise exception 'insufficient_balance' using errcode = 'P0001';
  end if;
  insert into billing.payouts (org_id, amount_agorot, idempotency_key)
  values (p_org_id, p_amount_agorot, p_idempotency_key)
  returning id into v_payout_id;
  perform kc_private.audit_record('payout_opened', 'payout', v_payout_id,
    jsonb_build_object('org_id', p_org_id, 'amount_agorot', p_amount_agorot), null);
  return v_payout_id;
end;
$$;
comment on function public.api_payout_open(uuid, bigint, text) is
  'Service role: opens a payout to an organization within its ledger balance.';

-- A platform admin opens a refund of a succeeded payment, in full or in part; the
-- provider's confirmation settles it. The same idempotency key returns the same refund.
-- Errors: forbidden (42501); P0001 payment_not_refundable, refund_exceeds_payment; 23514
-- for an unknown reason code.
create function public.admin_refund_payment(
  p_payment_id uuid,
  p_amount_agorot bigint,
  p_reason text,
  p_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.require_admin_role('admin');
  v_payment billing.payments;
  v_refund_id uuid;
begin
  select p.* into v_payment from billing.payments p
   where p.id = p_payment_id and p.status = 'succeeded' for update;
  if not found then
    raise exception 'payment_not_refundable' using errcode = 'P0001';
  end if;
  select r.id into v_refund_id from billing.refunds r where r.idempotency_key = p_idempotency_key;
  if found then
    return v_refund_id;
  end if;
  if p_amount_agorot > v_payment.amount_agorot - v_payment.refunded_agorot
       - coalesce((select sum(r.amount_agorot) from billing.refunds r
                    where r.payment_id = p_payment_id and r.status = 'pending'), 0) then
    raise exception 'refund_exceeds_payment' using errcode = 'P0001';
  end if;
  insert into billing.refunds (payment_id, amount_agorot, reason, idempotency_key, opened_by)
  values (p_payment_id, p_amount_agorot, p_reason, p_idempotency_key, v_actor)
  returning id into v_refund_id;
  perform kc_private.audit_record('refund_opened', 'refund', v_refund_id,
    jsonb_build_object('payment_id', p_payment_id, 'org_id', v_payment.org_id,
                       'amount_agorot', p_amount_agorot, 'reason', p_reason));
  return v_refund_id;
end;
$$;
comment on function public.admin_refund_payment(uuid, bigint, text, text) is
  'Platform admin: opens a full or partial refund of a succeeded payment.';
grant execute on function public.admin_refund_payment(uuid, bigint, text, text) to authenticated;
