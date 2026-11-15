-- 0364_money_donation_history_rpcs | Receipts + donation history for payers.

begin;

create or replace function public.list_my_donation_history(p_limit int default 50)
returns table (
  payment_id uuid,
  org_id uuid,
  org_name text,
  amount_ils numeric,
  paid_at timestamptz,
  receipt_id uuid,
  section46_serial text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.payment_id,
    p.org_id,
    o.name as org_name,
    p.amount_ils,
    p.created_at as paid_at,
    r.receipt_id,
    r.section46_serial
  from public.payments p
  join public.organizations o on o.org_id = p.org_id
  left join public.donation_receipts r on r.payment_id = p.payment_id
  where p.user_id = auth.uid()
    and p.status = 'succeeded'
  order by p.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

revoke all on function public.list_my_donation_history(int) from public;
grant execute on function public.list_my_donation_history(int) to authenticated;

create or replace function public.get_donation_receipt(p_payment_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row record;
begin
  select
    r.receipt_id,
    r.section46_serial,
    r.issued_at,
    r.payload,
    p.payment_id,
    p.amount_ils,
    p.created_at as paid_at,
    o.org_id,
    o.name as org_name,
    o.slug as org_slug
  into v_row
  from public.payments p
  join public.organizations o on o.org_id = p.org_id
  left join public.donation_receipts r on r.payment_id = p.payment_id
  where p.payment_id = p_payment_id
    and p.user_id = v_uid
    and p.status = 'succeeded';

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'receipt_id', v_row.receipt_id,
    'section46_serial', v_row.section46_serial,
    'issued_at', v_row.issued_at,
    'payload', v_row.payload,
    'payment_id', v_row.payment_id,
    'amount_ils', v_row.amount_ils,
    'paid_at', v_row.paid_at,
    'org_id', v_row.org_id,
    'org_name', v_row.org_name,
    'org_slug', v_row.org_slug,
    'sandbox', coalesce((v_row.payload->>'sandbox')::boolean, false)
  );
end;
$$;

revoke all on function public.get_donation_receipt(uuid) from public;
grant execute on function public.get_donation_receipt(uuid) to authenticated;

commit;
