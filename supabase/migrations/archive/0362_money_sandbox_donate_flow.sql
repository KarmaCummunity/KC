-- 0362_money_sandbox_donate_flow | Sandbox checkout completion (no real charges).

begin;

create or replace function public.complete_sandbox_donation(p_intent_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_intent public.donation_intents%rowtype;
  v_payment public.payments%rowtype;
  v_receipt public.donation_receipts%rowtype;
  v_pay_key text;
  v_serial text;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;

  select * into v_intent from public.donation_intents
   where intent_id = p_intent_id and user_id = v_uid for update;
  if not found then
    raise exception 'intent_not_found' using errcode = 'P0002';
  end if;
  if v_intent.status = 'paid' then
    select * into v_payment from public.payments where intent_id = v_intent.intent_id limit 1;
    select * into v_receipt from public.donation_receipts where payment_id = v_payment.payment_id;
    return jsonb_build_object(
      'payment_id', v_payment.payment_id,
      'receipt_id', v_receipt.receipt_id,
      'status', 'paid'
    );
  end if;
  if v_intent.status not in ('checkout', 'created') then
    raise exception 'intent_not_payable' using errcode = '23514';
  end if;

  v_pay_key := 'pay-' || v_intent.intent_id::text;

  insert into public.payments (
    intent_id, user_id, org_id, amount_ils, status,
    provider_id, provider_ref, idempotency_key
  ) values (
    v_intent.intent_id, v_uid, v_intent.org_id, v_intent.amount_ils, 'succeeded',
    v_intent.provider_id, coalesce(v_intent.provider_ref, 'sandbox-mock'),
    v_pay_key
  )
  on conflict (idempotency_key) do update set status = excluded.status
  returning * into v_payment;

  update public.donation_intents
     set status = 'paid', updated_at = now()
   where intent_id = v_intent.intent_id;

  v_serial := 'S46-SBX-' || upper(substr(replace(v_payment.payment_id::text, '-', ''), 1, 10));

  insert into public.donation_receipts (
    payment_id, org_id, user_id, section46_serial, payload
  ) values (
    v_payment.payment_id, v_intent.org_id, v_uid, v_serial,
    jsonb_build_object('sandbox', true, 'amount_ils', v_intent.amount_ils)
  )
  on conflict (payment_id) do nothing
  returning * into v_receipt;

  if v_receipt.receipt_id is null then
    select * into v_receipt from public.donation_receipts where payment_id = v_payment.payment_id;
  end if;

  insert into public.payer_kyc_profiles (user_id, cumulative_donated_ils)
  values (v_uid, v_intent.amount_ils)
  on conflict (user_id) do update
    set cumulative_donated_ils = payer_kyc_profiles.cumulative_donated_ils + excluded.cumulative_donated_ils,
        updated_at = now();

  return jsonb_build_object(
    'payment_id', v_payment.payment_id,
    'receipt_id', v_receipt.receipt_id,
    'section46_serial', v_receipt.section46_serial,
    'status', 'paid'
  );
end;
$$;

revoke all on function public.complete_sandbox_donation(uuid) from public;
grant execute on function public.complete_sandbox_donation(uuid) to authenticated;

commit;
