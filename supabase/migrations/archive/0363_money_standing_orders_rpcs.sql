-- 0363_money_standing_orders_rpcs | Monthly standing orders (sandbox provider).

begin;

create or replace function public.create_standing_order(
  p_org_id uuid,
  p_amount_ils numeric,
  p_idempotency_key text,
  p_cadence text default 'monthly'
)
returns public.standing_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.standing_orders;
  v_org public.organizations;
  v_provider uuid;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;
  if p_amount_ils is null or p_amount_ils < 5 then
    raise exception 'money_min_amount' using errcode = '23514';
  end if;
  if p_cadence is distinct from 'monthly' then
    raise exception 'cadence_not_supported' using errcode = '23514';
  end if;

  select * into v_org from public.organizations where org_id = p_org_id;
  if not found or not v_org.is_verified_nonprofit then
    raise exception 'verified_org_required' using errcode = '42501';
  end if;

  select provider_id into v_provider from public.payment_providers where slug = 'sandbox' limit 1;

  insert into public.standing_orders (
    user_id, org_id, amount_ils, cadence, status,
    provider_id, provider_ref, idempotency_key, next_charge_at
  ) values (
    v_uid, p_org_id, p_amount_ils, 'monthly', 'active',
    v_provider, 'sandbox-standing-' || gen_random_uuid()::text,
    p_idempotency_key, now() + interval '1 month'
  )
  on conflict (idempotency_key) do update set amount_ils = excluded.amount_ils
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.create_standing_order(uuid, numeric, text, text) from public;
grant execute on function public.create_standing_order(uuid, numeric, text, text) to authenticated;

create or replace function public.pause_standing_order(p_order_id uuid)
returns public.standing_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.standing_orders;
begin
  update public.standing_orders
     set status = 'paused'
   where order_id = p_order_id and user_id = auth.uid() and status = 'active'
  returning * into v_row;
  if not found then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;
  return v_row;
end;
$$;

revoke all on function public.pause_standing_order(uuid) from public;
grant execute on function public.pause_standing_order(uuid) to authenticated;

create or replace function public.list_my_standing_orders(p_limit int default 50)
returns setof public.standing_orders
language sql
stable
security definer
set search_path = public
as $$
  select so.*
    from public.standing_orders so
   where so.user_id = auth.uid()
   order by so.created_at desc
   limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

revoke all on function public.list_my_standing_orders(int) from public;
grant execute on function public.list_my_standing_orders(int) to authenticated;

commit;
