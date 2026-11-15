-- 0303_whatsapp_consent_notify | Issue #845
-- Opt-in, outbound rate limits, match notifications, accept/decline.

begin;

create table public.whatsapp_match_consent (
  user_id       uuid primary key references public.users(user_id) on delete cascade,
  opted_in      boolean not null default false,
  opted_in_at   timestamptz,
  opted_out_at  timestamptz,
  updated_at    timestamptz not null default now()
);

create trigger whatsapp_match_consent_set_updated_at
  before update on public.whatsapp_match_consent
  for each row execute function public.set_updated_at();

alter table public.whatsapp_match_consent enable row level security;

create policy whatsapp_match_consent_own on public.whatsapp_match_consent
  for select to authenticated using (user_id = auth.uid());

create table public.bot_match_responses (
  response_id   uuid primary key default gen_random_uuid(),
  match_id      uuid not null references public.listing_matches(match_id) on delete cascade,
  user_id       uuid not null references public.users(user_id) on delete cascade,
  response      text not null check (response in ('accept','decline')),
  created_at    timestamptz not null default now(),
  constraint bot_match_responses_once unique (match_id, user_id)
);

alter table public.bot_match_responses enable row level security;

create policy bot_match_responses_own on public.bot_match_responses
  for select to authenticated using (user_id = auth.uid());

create or replace function public.api_bot_set_match_consent(
  p_user_id uuid,
  p_opted_in boolean
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

  insert into public.whatsapp_match_consent (user_id, opted_in, opted_in_at, opted_out_at)
  values (
    p_user_id,
    p_opted_in,
    case when p_opted_in then now() else null end,
    case when not p_opted_in then now() else null end
  )
  on conflict (user_id) do update
    set opted_in = excluded.opted_in,
        opted_in_at = case when excluded.opted_in then now() else whatsapp_match_consent.opted_in_at end,
        opted_out_at = case when not excluded.opted_in then now() else null end,
        updated_at = now();
end;
$$;

create or replace function public.api_whatsapp_queue_outbound(
  p_user_id uuid,
  p_template_name text,
  p_payload jsonb,
  p_max_per_hour int default 5
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_consent boolean;
  v_recent int;
  v_id uuid;
  v_status text;
begin
  select opted_in into v_consent
    from public.whatsapp_match_consent where user_id = p_user_id;

  if coalesce(v_consent, false) is not true then
    insert into public.bot_outbound_messages (user_id, template_name, payload, status)
    values (p_user_id, p_template_name, p_payload, 'skipped_no_consent')
    returning outbound_id into v_id;
    return v_id;
  end if;

  select count(*) into v_recent
    from public.bot_outbound_messages
   where user_id = p_user_id
     and status in ('queued', 'sent')
     and created_at > now() - interval '1 hour';

  if v_recent >= greatest(coalesce(p_max_per_hour, 5), 1) then
    v_status := 'skipped_rate_limit';
  else
    v_status := 'queued';
  end if;

  insert into public.bot_outbound_messages (user_id, template_name, payload, status)
  values (p_user_id, p_template_name, p_payload, v_status)
  returning outbound_id into v_id;

  return v_id;
end;
$$;

create or replace function public.api_bot_enqueue_match_notifications(
  p_match_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match public.listing_matches;
  v_owner_a uuid;
  v_owner_b uuid;
  v_world text;
  v_out_a uuid;
  v_out_b uuid;
begin
  select * into v_match from public.listing_matches where match_id = p_match_id;
  if not found then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;
  if v_match.status <> 'suggested' then
    return jsonb_build_object('skipped', true, 'reason', 'not_suggested');
  end if;

  select la.owner_id, lb.owner_id, la.world_slug
    into v_owner_a, v_owner_b, v_world
    from public.listings la, public.listings lb
   where la.listing_id = v_match.listing_id
     and lb.listing_id = v_match.candidate_listing_id;

  v_out_a := public.api_whatsapp_queue_outbound(
    v_owner_a, 'match_found_v1',
    jsonb_build_object('match_id', p_match_id, 'world', v_world, 'role', 'a')
  );
  v_out_b := public.api_whatsapp_queue_outbound(
    v_owner_b, 'match_found_v1',
    jsonb_build_object('match_id', p_match_id, 'world', v_world, 'role', 'b')
  );

  return jsonb_build_object('owner_a_outbound', v_out_a, 'owner_b_outbound', v_out_b);
end;
$$;

create or replace function public.api_bot_record_match_response(
  p_match_id uuid,
  p_user_id uuid,
  p_response text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_owner_a uuid;
  v_owner_b uuid;
begin
  if p_response not in ('accept', 'decline') then
    raise exception 'invalid_response' using errcode = '22023';
  end if;

  select la.owner_id, lb.owner_id into v_owner_a, v_owner_b
    from public.listing_matches m
    join public.listings la on la.listing_id = m.listing_id
    join public.listings lb on lb.listing_id = m.candidate_listing_id
   where m.match_id = p_match_id;

  if p_user_id is distinct from v_owner_a and p_user_id is distinct from v_owner_b then
    raise exception 'not_match_participant' using errcode = '42501';
  end if;

  insert into public.bot_match_responses (match_id, user_id, response)
  values (p_match_id, p_user_id, p_response)
  on conflict (match_id, user_id) do update set response = excluded.response
  returning response_id into v_id;

  if p_response = 'accept' then
    update public.listing_matches set status = 'accepted' where match_id = p_match_id;
  elsif p_response = 'decline' then
    update public.listing_matches set status = 'dismissed' where match_id = p_match_id;
  end if;

  return v_id;
end;
$$;

create or replace function public.listing_matches_whatsapp_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'suggested' then
    perform public.api_bot_enqueue_match_notifications(new.match_id);
  end if;
  return new;
end;
$$;

drop trigger if exists listing_matches_whatsapp_notify on public.listing_matches;
create trigger listing_matches_whatsapp_notify
  after insert on public.listing_matches
  for each row execute function public.listing_matches_whatsapp_notify();

grant execute on function public.api_bot_set_match_consent(uuid, boolean) to service_role;
grant execute on function public.api_whatsapp_queue_outbound(uuid, text, jsonb, int) to service_role;
grant execute on function public.api_bot_enqueue_match_notifications(uuid) to service_role;
grant execute on function public.api_bot_record_match_response(uuid, uuid, text) to service_role;

commit;
