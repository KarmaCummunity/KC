-- Billing · what a donor calls (D4, D20; FR-DONATE-011, FR-FIN-021)
--
-- Every function identifies the caller, reads or writes `billing` with definer rights and
-- returns only the caller's own data. Amounts are agorot.
-- Errors, SQLSTATE P0001 unless noted: unauthenticated (42501), account_not_active,
-- money_min_amount, verified_org_required, payments_unavailable, idempotency_key_conflict,
-- cadence_not_supported, order_not_found, illegal_transition.

-- An organization may receive donations when it is active and either a verified nonprofit
-- or the platform organization itself (D20: donations to KC).
create function kc_private.billing_assert_can_donate(p_org_id uuid, p_amount_agorot bigint)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_amount_agorot is null or p_amount_agorot < (select s.min_donation_agorot from billing.settings s) then
    raise exception 'money_min_amount' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.organizations o
                  where o.id = p_org_id and o.status = 'active' and (o.is_verified_nonprofit or o.is_platform)) then
    raise exception 'verified_org_required' using errcode = 'P0001';
  end if;
end;
$$;

-- Starts a one-time donation and returns the intent. The app then asks the payments Edge
-- Function for the provider's checkout page. Repeating the call with the same key returns
-- the same intent; a key that belongs to another donation is refused.
create function public.create_donation_intent(
  p_org_id uuid,
  p_amount_agorot bigint,
  p_idempotency_key text,
  p_post_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_active_caller();
  v_intent billing.donation_intents;
begin
  select i.* into v_intent from billing.donation_intents i where i.idempotency_key = p_idempotency_key;
  if not found then
    perform kc_private.rate_limit_enforce('donation_intent', v_user_id);  -- 95_platform
    perform kc_private.billing_assert_can_donate(p_org_id, p_amount_agorot);
    insert into billing.donation_intents (user_id, org_id, post_id, amount_agorot, provider_id, idempotency_key)
    values (v_user_id, p_org_id, p_post_id, p_amount_agorot, kc_private.billing_default_provider(), p_idempotency_key)
    on conflict (idempotency_key) do nothing
    returning * into v_intent;
    if not found then
      select i.* into strict v_intent from billing.donation_intents i where i.idempotency_key = p_idempotency_key;
    end if;
  end if;
  if (v_intent.user_id, v_intent.org_id, v_intent.amount_agorot) is distinct from (v_user_id, p_org_id, p_amount_agorot) then
    raise exception 'idempotency_key_conflict' using errcode = 'P0001';
  end if;
  return jsonb_build_object('intent_id', v_intent.id, 'status', v_intent.status, 'org_id', v_intent.org_id,
                            'amount_agorot', v_intent.amount_agorot, 'currency', v_intent.currency,
                            'checkout_url', v_intent.checkout_url);
end;
$$;
comment on function public.create_donation_intent(uuid, bigint, text, uuid) is
  'Starts a one-time donation of the caller to an organization; idempotent on the key.';
grant execute on function public.create_donation_intent(uuid, bigint, text, uuid) to authenticated;

-- The caller's donations that went through, newest first, each with its receipt.
-- Keyset: pass paid_at and payment_id of the last row.
create function public.list_my_donation_history(
  p_limit integer default 50,
  p_after_paid_at timestamptz default null,
  p_after_id uuid default null
)
returns table (payment_id uuid, org_id uuid, org_name text, amount_agorot bigint, refunded_agorot bigint,
               currency text, status text, paid_at timestamptz, standing_order_id uuid,
               receipt_serial bigint, sec46_eligible boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.org_id, o.name, p.amount_agorot, p.refunded_agorot, p.currency, p.status, p.created_at,
         i.standing_order_id, r.serial, r.sec46_eligible
    from billing.payments p
    join billing.donation_intents i on i.id = p.intent_id
    join public.organizations o on o.id = p.org_id
    left join billing.receipts r on r.payment_id = p.id
   where p.user_id = (select auth.uid())
     and p.status in ('succeeded', 'refunded')
     and (p_after_paid_at is null or (p.created_at, p.id) < (p_after_paid_at, p_after_id))
   order by p.created_at desc, p.id desc
   limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;
comment on function public.list_my_donation_history(integer, timestamptz, uuid) is
  'The caller''s settled donations with their receipts, newest first (keyset).';
grant execute on function public.list_my_donation_history(integer, timestamptz, uuid) to authenticated;

-- The receipt of one of the caller's donations; null when the payment is not theirs or
-- has no receipt.
create function public.get_donation_receipt(p_payment_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'receipt_id', r.id, 'serial', r.serial, 'issued_at', r.issued_at, 'payment_id', r.payment_id,
           'amount_agorot', r.amount_agorot, 'currency', r.currency, 'sec46_eligible', r.sec46_eligible,
           'sec46_approval_number', r.sec46_approval_number,
           'org_id', o.id, 'org_name', o.name, 'org_slug', o.slug)
    from billing.receipts r
    join public.organizations o on o.id = r.org_id
   where r.payment_id = p_payment_id and r.user_id = (select auth.uid());
$$;
comment on function public.get_donation_receipt(uuid) is 'The receipt record of one of the caller''s donations.';
grant execute on function public.get_donation_receipt(uuid) to authenticated;

-- What the app shows of a standing order.
create function kc_private.standing_order_json(p_order billing.standing_orders)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'order_id', p_order.id, 'org_id', p_order.org_id,
    'org_name', (select o.name from public.organizations o where o.id = p_order.org_id),
    'amount_agorot', p_order.amount_agorot, 'currency', p_order.currency, 'cadence', p_order.cadence,
    'status', p_order.status, 'next_charge_at', p_order.next_charge_at, 'cancelled_at', p_order.cancelled_at,
    'created_at', p_order.created_at);
$$;

-- Starts a monthly standing order (FR-DONATE-011). It waits as `pending` until the
-- provider confirms the mandate. Idempotent on the key, like a one-time donation.
create function public.create_standing_order(
  p_org_id uuid,
  p_amount_agorot bigint,
  p_idempotency_key text,
  p_cadence text default 'monthly'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_active_caller();
  v_order billing.standing_orders;
begin
  select o.* into v_order from billing.standing_orders o where o.idempotency_key = p_idempotency_key;
  if not found then
    if p_cadence is distinct from 'monthly' then
      raise exception 'cadence_not_supported' using errcode = 'P0001';
    end if;
    perform kc_private.billing_assert_can_donate(p_org_id, p_amount_agorot);
    insert into billing.standing_orders (user_id, org_id, amount_agorot, cadence, provider_id, idempotency_key)
    values (v_user_id, p_org_id, p_amount_agorot, p_cadence, kc_private.billing_default_provider(), p_idempotency_key)
    returning * into v_order;
  end if;
  if (v_order.user_id, v_order.org_id, v_order.amount_agorot) is distinct from (v_user_id, p_org_id, p_amount_agorot) then
    raise exception 'idempotency_key_conflict' using errcode = 'P0001';
  end if;
  return kc_private.standing_order_json(v_order);
end;
$$;
comment on function public.create_standing_order(uuid, bigint, text, text) is
  'Starts a recurring donation of the caller to an organization; idempotent on the key.';
grant execute on function public.create_standing_order(uuid, bigint, text, text) to authenticated;

-- Moves one of the caller's standing orders: `paused`, `active` (resume) or `cancelled`.
-- A resumed order is charged again from now; repeating a move is a no-op.
create function kc_private.standing_order_move(p_order_id uuid, p_to text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_caller();
  v_order billing.standing_orders;
begin
  select o.* into v_order from billing.standing_orders o
   where o.id = p_order_id and o.user_id = v_user_id for update;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0001';
  end if;
  if v_order.status <> p_to then
    update billing.standing_orders o
       set status = p_to,
           next_charge_at = case when p_to = 'active' then now() end,
           cancelled_at = case when p_to = 'cancelled' then now() end
     where o.id = p_order_id
    returning * into v_order;
    perform kc_private.audit_record('standing_order_' || p_to, 'standing_order', p_order_id,
                                    jsonb_build_object('org_id', v_order.org_id));
  end if;
  return kc_private.standing_order_json(v_order);
end;
$$;

create function public.pause_standing_order(p_order_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select kc_private.standing_order_move(p_order_id, 'paused');
$$;
comment on function public.pause_standing_order(uuid) is 'Pauses the caller''s active standing order.';
grant execute on function public.pause_standing_order(uuid) to authenticated;

create function public.resume_standing_order(p_order_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select kc_private.standing_order_move(p_order_id, 'active');
$$;
comment on function public.resume_standing_order(uuid) is 'Resumes the caller''s paused standing order.';
grant execute on function public.resume_standing_order(uuid) to authenticated;

create function public.cancel_standing_order(p_order_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select kc_private.standing_order_move(p_order_id, 'cancelled');
$$;
comment on function public.cancel_standing_order(uuid) is 'Cancels the caller''s standing order for good.';
grant execute on function public.cancel_standing_order(uuid) to authenticated;

-- The caller's standing orders, newest first (a member has a handful at most).
create function public.list_my_standing_orders()
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select kc_private.standing_order_json(o)
    from billing.standing_orders o
   where o.user_id = (select auth.uid())
   order by o.created_at desc
   limit 100;
$$;
comment on function public.list_my_standing_orders() is 'The caller''s standing orders, newest first.';
grant execute on function public.list_my_standing_orders() to authenticated;
