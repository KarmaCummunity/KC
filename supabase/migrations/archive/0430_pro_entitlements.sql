-- 0430_pro_entitlements | Issue #1083: Pro entitlement model.
--
-- One row per user who has (or had) Pro. Writes are server-only (service_role: the
-- future RevenueCat webhook, admin SQL); clients can only read their own row.
-- Server-side code must gate Pro features with public.is_pro(user_id), never with a
-- client-supplied flag. With no rows (no store keys yet) everyone is simply not Pro.

create table if not exists public.user_entitlements (
  user_id     uuid primary key references public.users(user_id) on delete cascade,
  tier        text not null default 'pro' check (tier in ('pro')),
  source      text not null default 'admin' check (source in ('revenuecat', 'admin', 'promo')),
  active      boolean not null default true,
  expires_at  timestamptz,
  updated_at  timestamptz not null default now()
);

drop trigger if exists user_entitlements_set_updated_at on public.user_entitlements;
create trigger user_entitlements_set_updated_at
  before update on public.user_entitlements
  for each row execute function public.set_updated_at();

alter table public.user_entitlements enable row level security;

drop policy if exists user_entitlements_select_own on public.user_entitlements;
create policy user_entitlements_select_own on public.user_entitlements
  for select to authenticated using (user_id = (select auth.uid()));

revoke all on public.user_entitlements from anon, authenticated;
grant select on public.user_entitlements to authenticated;

-- Server-side check. Internal: not executable by client roles.
create or replace function public.is_pro(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_entitlements e
     where e.user_id = p_user_id
       and e.active
       and (e.expires_at is null or e.expires_at > now())
  );
$$;

revoke all on function public.is_pro(uuid) from public, anon, authenticated;
grant execute on function public.is_pro(uuid) to service_role;

-- Client read of the caller's own status (for the paywall / settings UI).
create or replace function public.api_my_pro_status()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'is_pro', public.is_pro((select auth.uid())),
    'expires_at', (select e.expires_at from public.user_entitlements e where e.user_id = (select auth.uid())),
    'source', (select e.source from public.user_entitlements e where e.user_id = (select auth.uid()))
  );
$$;

revoke all on function public.api_my_pro_status() from public, anon;
grant execute on function public.api_my_pro_status() to authenticated, service_role;

-- Server-only writer (RevenueCat webhook / admin).
create or replace function public.api_set_pro_entitlement(
  p_user_id uuid,
  p_active boolean,
  p_expires_at timestamptz default null,
  p_source text default 'admin'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    raise exception 'user_id_required' using errcode = '22023';
  end if;
  insert into public.user_entitlements (user_id, active, expires_at, source)
  values (p_user_id, coalesce(p_active, false), p_expires_at, coalesce(p_source, 'admin'))
  on conflict (user_id) do update
    set active = excluded.active,
        expires_at = excluded.expires_at,
        source = excluded.source;
end;
$$;

revoke all on function public.api_set_pro_entitlement(uuid, boolean, timestamptz, text) from public, anon, authenticated;
grant execute on function public.api_set_pro_entitlement(uuid, boolean, timestamptz, text) to service_role;
