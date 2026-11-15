-- 0365_money_payments_insert_policy | Allow security-definer RPC paths only (explicit deny direct insert).

begin;

-- Payments and receipts are created via complete_sandbox_donation / webhooks only.
-- Standing orders inserts via create_standing_order RPC.

create or replace function public.resume_standing_order(p_order_id uuid)
returns public.standing_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.standing_orders;
begin
  update public.standing_orders
     set status = 'active', next_charge_at = coalesce(next_charge_at, now() + interval '1 month')
   where order_id = p_order_id and user_id = auth.uid() and status = 'paused'
  returning * into v_row;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;
  return v_row;
end;
$$;

revoke all on function public.resume_standing_order(uuid) from public;
grant execute on function public.resume_standing_order(uuid) to authenticated;

commit;
