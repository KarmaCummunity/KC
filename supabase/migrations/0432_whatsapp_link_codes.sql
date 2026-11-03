-- 0432_whatsapp_link_codes | Issue #1090: link a WhatsApp number to a KC account with a
-- one-time code from the app (Pro only).
--
-- Flow: the signed-in Pro user calls api_whatsapp_create_link_code() in the app and gets a
-- 6-digit code (valid 10 minutes, only its SHA-256 is stored). They send the code to the KC
-- WhatsApp number; the webhook calls api_whatsapp_redeem_link_code(wa_id, code), which links
-- whatsapp_identities.wa_id -> user_id. One number per user: older links are cleared.
-- Brute force: max 5 failed redeems per wa_id per hour, on top of the inbound throttle.

create table if not exists public.whatsapp_link_codes (
  user_id     uuid primary key references public.users(user_id) on delete cascade,
  code_hash   text not null,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
create index if not exists whatsapp_link_codes_hash_idx on public.whatsapp_link_codes (code_hash);

create table if not exists public.whatsapp_link_failures (
  wa_id       text not null,
  failed_at   timestamptz not null default now()
);
create index if not exists whatsapp_link_failures_wa_idx on public.whatsapp_link_failures (wa_id, failed_at);

alter table public.whatsapp_link_codes enable row level security;
drop policy if exists whatsapp_link_codes_service_all on public.whatsapp_link_codes;
create policy whatsapp_link_codes_service_all on public.whatsapp_link_codes
  for all to service_role using (true) with check (true);
alter table public.whatsapp_link_failures enable row level security;
drop policy if exists whatsapp_link_failures_service_all on public.whatsapp_link_failures;
create policy whatsapp_link_failures_service_all on public.whatsapp_link_failures
  for all to service_role using (true) with check (true);
revoke all on public.whatsapp_link_codes from anon, authenticated;
revoke all on public.whatsapp_link_failures from anon, authenticated;

create or replace function public.whatsapp_link_code_hash(p_code text)
returns text
language sql
immutable
set search_path = public
as $$
  select encode(sha256(convert_to('kc-wa-link:' || btrim(p_code), 'UTF8')), 'hex');
$$;
revoke all on function public.whatsapp_link_code_hash(text) from public, anon, authenticated;
grant execute on function public.whatsapp_link_code_hash(text) to service_role;

-- App: issue a fresh code for the caller (replaces any previous one).
create or replace function public.api_whatsapp_create_link_code()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_code text;
  v_expires timestamptz := now() + interval '10 minutes';
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;
  if not public.is_pro(v_uid) then
    raise exception 'pro_required' using errcode = '42501';
  end if;
  -- gen_random_uuid() is CSPRNG-backed; take 32 bits -> 6 digits.
  v_code := lpad(((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint) % 1000000)::text, 6, '0');
  insert into public.whatsapp_link_codes (user_id, code_hash, expires_at)
  values (v_uid, public.whatsapp_link_code_hash(v_code), v_expires)
  on conflict (user_id) do update
    set code_hash = excluded.code_hash, expires_at = excluded.expires_at, created_at = now();
  return jsonb_build_object('code', v_code, 'expires_at', v_expires);
end;
$$;

-- App: is my account linked to a WhatsApp number? (masked)
create or replace function public.api_whatsapp_my_link_status()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'linked', i.wa_id is not null,
    'wa_id_masked', case when i.wa_id is null then null else '•••' || right(i.wa_id, 4) end,
    'is_pro', public.is_pro((select auth.uid()))
  )
  from (select 1) d
  left join lateral (
    select wa_id from public.whatsapp_identities
     where user_id = (select auth.uid()) order by updated_at desc limit 1
  ) i on true;
$$;

-- App: unlink my number(s).
create or replace function public.api_whatsapp_unlink_me()
returns void
language sql
security definer
set search_path = public
as $$
  update public.whatsapp_identities set user_id = null where user_id = (select auth.uid());
$$;

-- Webhook (service role): redeem a code sent from a WhatsApp number.
create or replace function public.api_whatsapp_redeem_link_code(p_wa_id text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  if p_wa_id is null or btrim(p_wa_id) = '' then
    raise exception 'wa_id_required' using errcode = '22023';
  end if;

  if (select count(*) from public.whatsapp_link_failures
       where wa_id = p_wa_id and failed_at > now() - interval '1 hour') >= 5 then
    return jsonb_build_object('status', 'locked');
  end if;

  select user_id into v_user from public.whatsapp_link_codes
   where code_hash = public.whatsapp_link_code_hash(coalesce(p_code, ''))
     and expires_at > now();

  if v_user is null then
    insert into public.whatsapp_link_failures (wa_id) values (p_wa_id);
    delete from public.whatsapp_link_failures where failed_at < now() - interval '1 day';
    return jsonb_build_object('status', 'invalid');
  end if;

  delete from public.whatsapp_link_codes where user_id = v_user;

  if not public.is_pro(v_user) then
    return jsonb_build_object('status', 'not_pro');
  end if;

  update public.whatsapp_identities set user_id = null
   where user_id = v_user and wa_id <> p_wa_id;
  insert into public.whatsapp_identities (wa_id, user_id) values (p_wa_id, v_user)
  on conflict (wa_id) do update set user_id = excluded.user_id, updated_at = now();
  delete from public.whatsapp_link_failures where wa_id = p_wa_id;

  return jsonb_build_object('status', 'linked', 'user_id', v_user);
end;
$$;

revoke all on function public.api_whatsapp_create_link_code() from public, anon;
revoke all on function public.api_whatsapp_my_link_status() from public, anon;
revoke all on function public.api_whatsapp_unlink_me() from public, anon;
revoke all on function public.api_whatsapp_redeem_link_code(text, text) from public, anon, authenticated;
grant execute on function public.api_whatsapp_create_link_code() to authenticated;
grant execute on function public.api_whatsapp_my_link_status() to authenticated;
grant execute on function public.api_whatsapp_unlink_me() to authenticated;
grant execute on function public.api_whatsapp_redeem_link_code(text, text) to service_role;
