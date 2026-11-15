-- Billing · member entitlements (Pro tier)
--
-- Whether a member holds the paid tier, and until when. The store purchase itself is
-- handled by RevenueCat; its webhook (Edge Function `revenuecat-webhook`, service role)
-- reports the state here. An entitlement granted by hand (support, promotion) is never
-- overwritten by the store.

create table billing.user_entitlements (
  user_id    uuid primary key references public.users (id) on delete cascade,
  tier       text not null default 'pro' check (tier in ('pro')),
  source     text not null check (source in ('revenuecat', 'admin', 'promo')),
  active     boolean not null default true,
  -- Null = no end date.
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);
comment on table billing.user_entitlements is 'Paid-tier entitlement of a member, as reported by the store or granted by hand.';

create trigger user_entitlements_set_updated_at
  before update on billing.user_entitlements
  for each row execute function kc_private.set_updated_at();

alter table billing.user_entitlements enable row level security;
alter table billing.user_entitlements force row level security;
revoke insert, update, delete, truncate on billing.user_entitlements from service_role;

-- True while the member's entitlement is switched on and has not run out.
create function kc_private.is_pro(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from billing.user_entitlements e
     where e.user_id = p_user_id and e.active and (e.expires_at is null or e.expires_at > now()));
$$;
comment on function kc_private.is_pro(uuid) is 'The member holds the Pro tier right now.';

-- The caller's own tier.
create function public.api_my_pro_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'is_pro', kc_private.is_pro((select auth.uid())),
    'expires_at', (select e.expires_at from billing.user_entitlements e where e.user_id = (select auth.uid())),
    'source', (select e.source from billing.user_entitlements e where e.user_id = (select auth.uid())));
$$;
comment on function public.api_my_pro_status() is 'Whether the caller holds the Pro tier, until when and from which source.';
grant execute on function public.api_my_pro_status() to authenticated;

-- Sets a member's entitlement from a given source and returns what happened:
--   unknown_user          no such member
--   skipped_manual_grant  the store may not replace an active entitlement granted by hand
--   granted | revoked
create function kc_private.entitlement_set(p_user_id uuid, p_active boolean, p_expires_at timestamptz, p_source text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.users u where u.id = p_user_id) then
    return jsonb_build_object('status', 'unknown_user');
  end if;
  if p_source = 'revenuecat' and exists (
       select 1 from billing.user_entitlements e
        where e.user_id = p_user_id and e.source <> 'revenuecat' and e.active) then
    return jsonb_build_object('status', 'skipped_manual_grant');
  end if;
  insert into billing.user_entitlements (user_id, source, active, expires_at)
  values (p_user_id, p_source, coalesce(p_active, false), p_expires_at)
  on conflict (user_id) do update
    set source = excluded.source, active = excluded.active, expires_at = excluded.expires_at;
  return jsonb_build_object('status', case when p_active then 'granted' else 'revoked' end);
end;
$$;

create function public.api_revenuecat_set_pro(p_user_id uuid, p_active boolean, p_expires_at timestamptz)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select kc_private.entitlement_set(p_user_id, p_active, p_expires_at, 'revenuecat');
$$;
comment on function public.api_revenuecat_set_pro(uuid, boolean, timestamptz) is
  'Service role (RevenueCat webhook): reports a member''s store subscription state.';

create function public.api_set_pro_entitlement(
  p_user_id uuid,
  p_active boolean,
  p_expires_at timestamptz default null,
  p_source text default 'admin'
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select kc_private.entitlement_set(p_user_id, p_active, p_expires_at, p_source);
$$;
comment on function public.api_set_pro_entitlement(uuid, boolean, timestamptz, text) is
  'Service role (operations): grants or revokes the Pro tier by hand.';
