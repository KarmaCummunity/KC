-- RevenueCat → Pro sync. Called only by the revenuecat-webhook Edge Function (service_role).
create or replace function public.api_revenuecat_set_pro(
  p_user_id uuid, p_active boolean, p_expires_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.users where user_id = p_user_id) then
    return jsonb_build_object('status', 'unknown_user');
  end if;
  -- Never override a manual admin/promo grant from a store event.
  if exists (select 1 from public.user_entitlements
              where user_id = p_user_id and source <> 'revenuecat' and active) then
    return jsonb_build_object('status', 'skipped_manual_grant');
  end if;
  insert into public.user_entitlements (user_id, tier, source, active, expires_at)
  values (p_user_id, 'pro', 'revenuecat', p_active, p_expires_at)
  on conflict (user_id) do update
    set source = 'revenuecat', active = excluded.active, expires_at = excluded.expires_at;
  return jsonb_build_object('status', case when p_active then 'granted' else 'revoked' end);
end; $$;
revoke all on function public.api_revenuecat_set_pro(uuid, boolean, timestamptz) from public, anon, authenticated;
grant execute on function public.api_revenuecat_set_pro(uuid, boolean, timestamptz) to service_role;
