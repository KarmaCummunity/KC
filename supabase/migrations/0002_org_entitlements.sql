-- Billing · organization entitlement (#2150, product decision D-210)
--
-- An organization holds its own paid plan, separate from the Pro tier of a member
-- (billing.user_entitlements). The plan belongs to the organization itself, not to the
-- admin who bought it, so it survives a change of admins. The store purchase is handled by
-- RevenueCat; its webhook (Edge Function `revenuecat-webhook`, service role) reports the
-- state here. An entitlement granted by hand (support, promotion) is never overwritten by
-- the store. Nothing is gated on it during the free first year; this only records it.

create table billing.organization_entitlements (
  org_id     uuid primary key references public.organizations (id) on delete cascade,
  source     text not null check (source in ('revenuecat', 'admin', 'promo')),
  active     boolean not null default true,
  -- Null = no end date.
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);
comment on table billing.organization_entitlements is
  'Paid plan of an organization, as reported by the store or granted by hand.';

create trigger organization_entitlements_set_updated_at
  before update on billing.organization_entitlements
  for each row execute function kc_private.set_updated_at();

-- Closed to every client role, service_role included: the table is reached only through the
-- security-definer functions below, which run as its owner.
alter table billing.organization_entitlements enable row level security;
alter table billing.organization_entitlements force row level security;
revoke all on billing.organization_entitlements from service_role;

-- True while the organization's plan is switched on and has not run out.
create function kc_private.org_entitlement_active(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from billing.organization_entitlements e
     where e.org_id = p_org_id and e.active and (e.expires_at is null or e.expires_at > now()));
$$;
comment on function kc_private.org_entitlement_active(uuid) is 'The organization holds its paid plan right now.';

-- The plan of an organization the caller manages (org_admin or org_manager); anyone else
-- is refused, so one organization never reads another's billing state.
create function public.api_org_entitlement_status(p_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_org_id is null or not (p_org_id = any (kc_access.managed_org_ids())) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'has_plan', kc_private.org_entitlement_active(p_org_id),
    'expires_at', (select e.expires_at from billing.organization_entitlements e where e.org_id = p_org_id),
    'source', (select e.source from billing.organization_entitlements e where e.org_id = p_org_id));
end;
$$;
comment on function public.api_org_entitlement_status(uuid) is
  'Managers of an organization: whether it holds its paid plan, until when and from which source.';
grant execute on function public.api_org_entitlement_status(uuid) to authenticated;

-- Sets an organization's entitlement from a given source and returns what happened:
--   unknown_organization  no such organization
--   skipped_manual_grant  the store may not replace an active entitlement granted by hand
--   granted | revoked
create function kc_private.org_entitlement_set(p_org_id uuid, p_active boolean, p_expires_at timestamptz, p_source text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.organizations o where o.id = p_org_id) then
    return jsonb_build_object('status', 'unknown_organization');
  end if;
  if p_source = 'revenuecat' and exists (
       select 1 from billing.organization_entitlements e
        where e.org_id = p_org_id and e.source <> 'revenuecat' and e.active) then
    return jsonb_build_object('status', 'skipped_manual_grant');
  end if;
  insert into billing.organization_entitlements (org_id, source, active, expires_at)
  values (p_org_id, p_source, coalesce(p_active, false), p_expires_at)
  on conflict (org_id) do update
    set source = excluded.source, active = excluded.active, expires_at = excluded.expires_at;
  return jsonb_build_object('status', case when p_active then 'granted' else 'revoked' end);
end;
$$;

create function public.api_revenuecat_set_org_entitlement(p_org_id uuid, p_active boolean, p_expires_at timestamptz)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select kc_private.org_entitlement_set(p_org_id, p_active, p_expires_at, 'revenuecat');
$$;
comment on function public.api_revenuecat_set_org_entitlement(uuid, boolean, timestamptz) is
  'Service role (RevenueCat webhook): reports an organization''s store subscription state.';

create function public.api_set_org_entitlement(
  p_org_id uuid,
  p_active boolean,
  p_expires_at timestamptz default null,
  p_source text default 'admin'
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select kc_private.org_entitlement_set(p_org_id, p_active, p_expires_at, p_source);
$$;
comment on function public.api_set_org_entitlement(uuid, boolean, timestamptz, text) is
  'Service role (operations): grants or revokes an organization''s paid plan by hand.';
