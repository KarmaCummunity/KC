-- 0431_whatsapp_inbound_claims | Issue #1089: dedupe Meta webhook retries by message id.
--
-- Meta retries a webhook delivery when it does not get a fast 200, so the same wamid can
-- arrive more than once. The webhook claims each message id before doing any work
-- (consent keywords, replies, the agent); a second delivery of the same id is skipped.
-- If processing fails, the webhook releases the claim so Meta's retry is handled.

create table if not exists public.whatsapp_inbound_claims (
  message_id  text primary key check (btrim(message_id) <> ''),
  claimed_at  timestamptz not null default now()
);

create index if not exists whatsapp_inbound_claims_claimed_at_idx
  on public.whatsapp_inbound_claims (claimed_at);

alter table public.whatsapp_inbound_claims enable row level security;
drop policy if exists whatsapp_inbound_claims_service_all on public.whatsapp_inbound_claims;
create policy whatsapp_inbound_claims_service_all on public.whatsapp_inbound_claims
  for all to service_role using (true) with check (true);
revoke all on public.whatsapp_inbound_claims from anon, authenticated;

-- true = first delivery (go ahead), false = duplicate (skip).
create or replace function public.api_whatsapp_claim_inbound(p_message_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_message_id is null or btrim(p_message_id) = '' then
    raise exception 'message_id_required' using errcode = '22023';
  end if;
  -- Opportunistic retention: claims only matter for Meta's retry window (hours).
  delete from public.whatsapp_inbound_claims where claimed_at < now() - interval '7 days';
  insert into public.whatsapp_inbound_claims (message_id) values (p_message_id)
  on conflict (message_id) do nothing;
  return found;
end;
$$;

create or replace function public.api_whatsapp_release_inbound(p_message_id text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.whatsapp_inbound_claims where message_id = p_message_id;
$$;

revoke all on function public.api_whatsapp_claim_inbound(text) from public, anon, authenticated;
revoke all on function public.api_whatsapp_release_inbound(text) from public, anon, authenticated;
grant execute on function public.api_whatsapp_claim_inbound(text) to service_role;
grant execute on function public.api_whatsapp_release_inbound(text) to service_role;
