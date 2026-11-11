-- 0302_bot_sessions_intake | Issue #844
-- WhatsApp identity linkage, conversation sessions, extraction + publish via api_*.

begin;

create table public.bot_admin_review_items (
  review_id       uuid primary key default gen_random_uuid(),
  extraction_id   uuid references public.extractions(extraction_id) on delete cascade,
  listing_id      uuid references public.listings(listing_id) on delete set null,
  reason          text not null,
  status          text not null default 'pending'
    check (status in ('pending','approved','rejected')),
  reviewer_id     uuid references public.users(user_id) on delete set null,
  created_at        timestamptz not null default now(),
  resolved_at       timestamptz
);

create index bot_admin_review_pending_idx
  on public.bot_admin_review_items (status, created_at desc)
  where status = 'pending';

alter table public.bot_admin_review_items enable row level security;

create policy bot_admin_review_operator on public.bot_admin_review_items
  for select to authenticated using (public.is_listing_operator(auth.uid()));

create or replace function public.api_bot_admin_review_enqueue(
  p_extraction_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.bot_admin_review_items (extraction_id, reason)
  values (p_extraction_id, p_reason)
  returning review_id into v_id;
  return v_id;
end;
$$;

grant execute on function public.api_bot_admin_review_enqueue(uuid, text) to service_role;

create table public.whatsapp_identities (
  identity_id   uuid primary key default gen_random_uuid(),
  wa_id         text not null unique,
  user_id       uuid references public.users(user_id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger whatsapp_identities_set_updated_at
  before update on public.whatsapp_identities
  for each row execute function public.set_updated_at();

create table public.bot_conversation_sessions (
  session_id    uuid primary key default gen_random_uuid(),
  identity_id   uuid not null references public.whatsapp_identities(identity_id) on delete cascade,
  record_id     uuid references public.raw_records(record_id) on delete set null,
  state         text not null default 'collecting'
    check (state in ('collecting','confirm','published','idle')),
  draft         jsonb not null default '{}'::jsonb,
  extraction_id uuid references public.extractions(extraction_id) on delete set null,
  listing_id    uuid references public.listings(listing_id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index bot_conversation_sessions_identity_idx
  on public.bot_conversation_sessions (identity_id, updated_at desc);

create trigger bot_conversation_sessions_set_updated_at
  before update on public.bot_conversation_sessions
  for each row execute function public.set_updated_at();

alter table public.whatsapp_identities enable row level security;
alter table public.bot_conversation_sessions enable row level security;
revoke all on public.whatsapp_identities from authenticated, anon;
revoke all on public.bot_conversation_sessions from authenticated, anon;
-- Phone identities and conversation state are bot-internal (service_role only).
create policy whatsapp_identities_service_all on public.whatsapp_identities
  for all to service_role using (true) with check (true);
create policy bot_conversation_sessions_service_all on public.bot_conversation_sessions
  for all to service_role using (true) with check (true);

create or replace function public.api_bot_link_identity(
  p_wa_id text,
  p_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_wa_id is null or btrim(p_wa_id) = '' then
    raise exception 'wa_id_required' using errcode = '22023';
  end if;
  if p_user_id is null then
    raise exception 'user_id_required' using errcode = '22023';
  end if;

  insert into public.whatsapp_identities (wa_id, user_id)
  values (p_wa_id, p_user_id)
  on conflict (wa_id) do update
    set user_id = excluded.user_id, updated_at = now()
  returning identity_id into v_id;
  return v_id;
end;
$$;

create or replace function public.api_bot_open_session(
  p_wa_id text,
  p_record_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity uuid;
  v_session uuid;
begin
  select identity_id into v_identity from public.whatsapp_identities where wa_id = p_wa_id;
  if v_identity is null then
    insert into public.whatsapp_identities (wa_id) values (p_wa_id)
    returning identity_id into v_identity;
  end if;

  insert into public.bot_conversation_sessions (identity_id, record_id, state)
  values (v_identity, p_record_id, 'collecting')
  returning session_id into v_session;

  return v_session;
end;
$$;

create or replace function public.api_bot_apply_extraction(
  p_session_id uuid,
  p_world_slug text,
  p_kind_slug text,
  p_direction text,
  p_title text,
  p_details jsonb default '{}'::jsonb,
  p_confidence numeric default null,
  p_summary text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sess public.bot_conversation_sessions;
  v_record_id uuid;
  v_ext_id uuid;
  v_kind_id uuid;
begin
  select * into v_sess from public.bot_conversation_sessions where session_id = p_session_id;
  if not found then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;

  v_record_id := v_sess.record_id;
  if v_record_id is null then
    raise exception 'session_missing_record' using errcode = '22023';
  end if;

  select kind_id into v_kind_id
    from public.listing_kinds
   where world_slug = p_world_slug and slug = p_kind_slug;
  if v_kind_id is null then
    raise exception 'kind_not_found' using errcode = 'P0002';
  end if;

  if p_direction not in ('give', 'request') then
    raise exception 'invalid_direction' using errcode = '22023';
  end if;

  insert into public.extractions (record_id, world_slug, kind_slug, confidence, extracted)
  values (
    v_record_id,
    p_world_slug,
    p_kind_slug,
    p_confidence,
    jsonb_build_object(
      'direction', p_direction,
      'title', p_title,
      'summary', p_summary,
      'details', coalesce(p_details, '{}'::jsonb),
      'kind_id', v_kind_id
    )
  )
  returning extraction_id into v_ext_id;

  update public.bot_conversation_sessions
     set extraction_id = v_ext_id,
         state = 'confirm',
         draft = jsonb_build_object(
           'world_slug', p_world_slug,
           'kind_slug', p_kind_slug,
           'kind_id', v_kind_id,
           'direction', p_direction,
           'title', p_title,
           'summary', p_summary,
           'details', coalesce(p_details, '{}'::jsonb),
           'confidence', p_confidence
         ),
         updated_at = now()
   where session_id = p_session_id;

  if coalesce(p_confidence, 1) < 0.75 then
    perform public.api_bot_admin_review_enqueue(v_ext_id, 'low_confidence_extraction');
  end if;

  return v_ext_id;
end;
$$;

create or replace function public.api_bot_publish_listing(
  p_session_id uuid,
  p_owner_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sess public.bot_conversation_sessions;
  v_identity public.whatsapp_identities;
  v_draft jsonb;
  v_listing_id uuid;
  v_source_id uuid;
  v_mod text;
  v_conf numeric;
begin
  select * into v_sess from public.bot_conversation_sessions where session_id = p_session_id;
  if not found then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;
  if v_sess.state <> 'confirm' then
    raise exception 'session_not_ready' using errcode = '22023';
  end if;

  select * into v_identity from public.whatsapp_identities where identity_id = v_sess.identity_id;
  if v_identity.user_id is not null and v_identity.user_id <> p_owner_id then
    raise exception 'owner_mismatch' using errcode = '42501';
  end if;

  v_draft := v_sess.draft;
  v_conf := (v_draft->>'confidence')::numeric;

  v_mod := case when coalesce(v_conf, 1) >= 0.85 then 'published' else 'pending_review' end;

  insert into public.listings (
    owner_id, world_slug, kind_id, direction, title, summary, details,
    origin, moderation_status, published_at, anonymity_level
  )
  values (
    p_owner_id,
    v_draft->>'world_slug',
    (v_draft->>'kind_id')::uuid,
    v_draft->>'direction',
    v_draft->>'title',
    nullif(v_draft->>'summary', ''),
    coalesce(v_draft->'details', '{}'::jsonb),
    'ingestion',
    v_mod,
    case when v_mod = 'published' then now() else null end,
    3
  )
  returning listing_id into v_listing_id;

  select source_id into v_source_id from public.ingestion_sources where slug = 'whatsapp-cloud';

  update public.extractions
     set listing_id = v_listing_id
   where extraction_id = v_sess.extraction_id;

  insert into public.field_provenance (listing_id, field_path, source_id, record_id)
  select v_listing_id, 'title', v_source_id, v_sess.record_id
  union all
  select v_listing_id, 'details', v_source_id, v_sess.record_id;

  update public.bot_conversation_sessions
     set listing_id = v_listing_id, state = 'published', updated_at = now()
   where session_id = p_session_id;

  if v_mod = 'pending_review' and v_sess.extraction_id is not null then
    perform public.api_bot_admin_review_enqueue(v_sess.extraction_id, 'publish_pending_review');
  end if;

  return v_listing_id;
end;
$$;

grant execute on function public.api_bot_link_identity(text, uuid) to service_role;
grant execute on function public.api_bot_open_session(text, uuid) to service_role;
grant execute on function public.api_bot_apply_extraction(uuid, text, text, text, text, jsonb, numeric, text) to service_role;
grant execute on function public.api_bot_publish_listing(uuid, uuid) to service_role;

commit;
