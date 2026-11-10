-- Billing · settling money moves
--
-- The functions that turn a provider's word into records. Each one is a single
-- transaction step: the business row, its ledger lines, the receipt, the organization's
-- books, the audit event and the notification are written together or not at all. Each
-- one is safe to repeat: a second call for the same record changes nothing.

insert into kc_private.notification_kinds (kind, category, title_key, body_key) values
  -- D20: the donor receives a confirmation.
  ('donation_succeeded', 'critical', 'notifications.donationSucceededTitle', 'notifications.donationSucceededBody'),
  ('donation_refunded', 'critical', 'notifications.donationRefundedTitle', 'notifications.donationRefundedBody'),
  -- A charge of a standing order did not go through (D80 lists it as a tracked event).
  ('standing_order_charge_failed', 'critical', 'notifications.standingOrderChargeFailedTitle',
   'notifications.standingOrderChargeFailedBody');

-- Tells a member about a money event of theirs; nothing for a purged account.
create function kc_private.billing_notify(p_kind text, p_user_id uuid, p_entity_type text, p_entity_id uuid, p_data jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  select kc_private.outbox_enqueue('notification', jsonb_build_object(
    'kind', p_kind, 'recipient_id', p_user_id, 'actor_id', null,
    'entity', jsonb_build_object('type', p_entity_type, 'id', p_entity_id),
    'data', p_data || jsonb_build_object('dedupe_key', p_kind || ':' || p_entity_id)))
   where p_user_id is not null;
$$;

-- The provider reports the outcome of an intent's charge. Success: the payment, its
-- ledger transaction, the receipt and the mirrored book entry. Failure: a failed payment
-- row, and a notice when it was a standing-order charge. Returns the payment id, or null
-- when the intent was already settled that way.
-- Errors: P0001 intent_not_found, intent_not_payable, amount_mismatch.
create function kc_private.billing_payment_settle(
  p_intent_id uuid,
  p_succeeded boolean,
  p_event_key text,
  p_provider_ref text,
  p_amount_agorot bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent billing.donation_intents;
  v_payment_id uuid;
begin
  select i.* into v_intent from billing.donation_intents i where i.id = p_intent_id for update;
  if not found then
    raise exception 'intent_not_found' using errcode = 'P0001';
  elsif v_intent.status = 'succeeded' or (v_intent.status = 'failed' and not p_succeeded) then
    return null;
  elsif v_intent.status not in ('checkout', 'failed') then
    raise exception 'intent_not_payable' using errcode = 'P0001';
  elsif p_amount_agorot is distinct from v_intent.amount_agorot and p_amount_agorot is not null then
    raise exception 'amount_mismatch' using errcode = 'P0001';
  end if;

  insert into billing.payments (intent_id, user_id, user_tombstone, org_id, amount_agorot, currency, status,
                                provider_id, provider_ref, idempotency_key)
  values (p_intent_id, v_intent.user_id, v_intent.user_tombstone, v_intent.org_id, v_intent.amount_agorot,
          v_intent.currency, case when p_succeeded then 'succeeded' else 'failed' end,
          v_intent.provider_id, p_provider_ref, p_event_key)
  returning id into v_payment_id;

  perform set_config('kc.fsm_role', 'provider', true);
  update billing.donation_intents i
     set status = case when p_succeeded then 'succeeded' else 'failed' end
   where i.id = p_intent_id;
  perform set_config('kc.fsm_role', '', true);

  perform kc_private.audit_record(
    case when p_succeeded then 'payment_succeeded' else 'payment_failed' end, 'payment', v_payment_id,
    jsonb_build_object('intent_id', p_intent_id, 'org_id', v_intent.org_id, 'amount_agorot', v_intent.amount_agorot,
                       'standing_order_id', v_intent.standing_order_id), null);

  if not p_succeeded then
    if v_intent.standing_order_id is not null then
      perform kc_private.billing_notify('standing_order_charge_failed', v_intent.user_id, 'standing_order',
        v_intent.standing_order_id, jsonb_build_object('org_id', v_intent.org_id, 'intent_id', p_intent_id));
    end if;
    return v_payment_id;
  end if;

  perform kc_private.ledger_post('payment', v_payment_id, v_intent.org_id, 'provider_clearing', 'org_payable',
                                 v_intent.amount_agorot);
  perform kc_private.billing_receipt_issue(v_payment_id);
  perform kc_private.org_finance_mirror(
    v_intent.org_id, 'donation_in', v_intent.amount_agorot, now(), 'payment:' || v_payment_id,
    v_intent.provider_id, v_intent.user_id, v_intent.user_tombstone,
    case when v_intent.standing_order_id is null then 'individual_donations' else 'standing_orders' end);
  perform kc_private.billing_notify('donation_succeeded', v_intent.user_id, 'payment', v_payment_id,
    jsonb_build_object('org_id', v_intent.org_id, 'amount_agorot', v_intent.amount_agorot));
  return v_payment_id;
end;
$$;
comment on function kc_private.billing_payment_settle(uuid, boolean, text, text, bigint) is
  'Applies the provider''s outcome of a donation intent: payment, ledger, receipt, books, audit, notice — atomically.';

-- The provider reports the outcome of a refund. Success posts the ledger, adds the amount
-- to the payment's refunded total (a full refund marks the payment `refunded`) and
-- mirrors it into the books. Errors: P0001 refund_not_found.
create function kc_private.billing_refund_settle(p_refund_id uuid, p_succeeded boolean, p_provider_ref text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_refund billing.refunds;
  v_payment billing.payments;
begin
  select r.* into v_refund from billing.refunds r where r.id = p_refund_id for update;
  if not found then
    raise exception 'refund_not_found' using errcode = 'P0001';
  elsif v_refund.status <> 'pending' then
    return;
  end if;
  select p.* into strict v_payment from billing.payments p where p.id = v_refund.payment_id for update;

  perform set_config('kc.fsm_role', 'provider', true);
  update billing.refunds r
     set status = case when p_succeeded then 'succeeded' else 'failed' end,
         provider_ref = coalesce(p_provider_ref, r.provider_ref), settled_at = now()
   where r.id = p_refund_id;
  if p_succeeded then
    update billing.payments p
       set refunded_agorot = p.refunded_agorot + v_refund.amount_agorot,
           status = case when p.refunded_agorot + v_refund.amount_agorot = p.amount_agorot
                         then 'refunded' else p.status end
     where p.id = v_payment.id;
  end if;
  perform set_config('kc.fsm_role', '', true);

  perform kc_private.audit_record('refund_settled', 'refund', p_refund_id,
    jsonb_build_object('payment_id', v_payment.id, 'org_id', v_payment.org_id, 'succeeded', p_succeeded,
                       'amount_agorot', v_refund.amount_agorot), null);
  if not p_succeeded then
    return;
  end if;
  perform kc_private.ledger_post('refund', p_refund_id, v_payment.org_id, 'org_payable', 'provider_clearing',
                                 v_refund.amount_agorot);
  perform kc_private.org_finance_mirror(
    v_payment.org_id, 'refund_out', v_refund.amount_agorot, now(), 'refund:' || p_refund_id,
    v_payment.provider_id, v_payment.user_id, v_payment.user_tombstone, 'donor_refunds');
  perform kc_private.billing_notify('donation_refunded', v_payment.user_id, 'payment', v_payment.id,
    jsonb_build_object('org_id', v_payment.org_id, 'amount_agorot', v_refund.amount_agorot,
                       'refund_id', p_refund_id));
end;
$$;
comment on function kc_private.billing_refund_settle(uuid, boolean, text) is
  'Applies the provider''s outcome of a refund, with its ledger transaction and book entry.';

-- The provider reports the outcome of a payout. Errors: P0001 payout_not_found.
create function kc_private.billing_payout_settle(p_payout_id uuid, p_succeeded boolean, p_provider_ref text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payout billing.payouts;
begin
  select p.* into v_payout from billing.payouts p where p.id = p_payout_id for update;
  if not found then
    raise exception 'payout_not_found' using errcode = 'P0001';
  elsif v_payout.status <> 'pending' then
    return;
  end if;
  perform set_config('kc.fsm_role', 'provider', true);
  update billing.payouts p
     set status = case when p_succeeded then 'succeeded' else 'failed' end,
         provider_ref = coalesce(p_provider_ref, p.provider_ref), settled_at = now()
   where p.id = p_payout_id;
  perform set_config('kc.fsm_role', '', true);
  if p_succeeded then
    perform kc_private.ledger_post('payout', p_payout_id, v_payout.org_id, 'org_payable', 'provider_clearing',
                                   v_payout.amount_agorot);
  end if;
  perform kc_private.audit_record('payout_settled', 'payout', p_payout_id,
    jsonb_build_object('org_id', v_payout.org_id, 'succeeded', p_succeeded,
                       'amount_agorot', v_payout.amount_agorot), null);
end;
$$;
comment on function kc_private.billing_payout_settle(uuid, boolean, text) is
  'Applies the provider''s outcome of a payout, with its ledger transaction.';

-- The provider confirmed a standing-order mandate: the order becomes active and its first
-- charge is due at once. Repeating the event changes nothing.
create function kc_private.billing_standing_order_activate(p_order_id uuid, p_provider_ref text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('kc.fsm_role', 'provider', true);
  update billing.standing_orders o
     set status = 'active', provider_ref = p_provider_ref, next_charge_at = now()
   where o.id = p_order_id and o.status = 'pending';
  perform set_config('kc.fsm_role', '', true);
end;
$$;

-- The provider reports the KYC state of a payer (member) or a recipient (organization).
create function kc_private.billing_kyc_set(p_party_type text, p_party_id uuid, p_status text, p_provider_ref text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('kc.fsm_role', 'provider', true);
  insert into billing.kyc_profiles (party_type, user_id, org_id, provider_ref)
  values (p_party_type, case p_party_type when 'payer' then p_party_id end,
          case p_party_type when 'recipient' then p_party_id end, p_provider_ref)
  on conflict do nothing;
  update billing.kyc_profiles k
     set status = p_status, provider_ref = coalesce(p_provider_ref, k.provider_ref),
         verified_at = case when p_status = 'approved' then now() else k.verified_at end
   where k.party_type = p_party_type and p_party_id in (k.user_id, k.org_id);
  perform set_config('kc.fsm_role', '', true);
end;
$$;
comment on function kc_private.billing_kyc_set(text, uuid, text, text) is
  'Records the KYC state the provider reports for a payer or a recipient organization.';
