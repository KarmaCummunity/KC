-- Identity · user_consents
--
-- One append-only record of everything a member agreed to: the legal documents, the driver
-- declaration of the rides world and the code of conduct of the housing world. A row is the
-- evidence of a consent, so it is never changed and leaves only together with its member.

create table public.user_consents (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users (id) on delete cascade,
  -- terms / privacy refer to legal_document_versions; the two world consents are versioned
  -- by the module that asks for them.
  consent_kind text not null
                 check (consent_kind in ('terms', 'privacy', 'driver_declaration', 'housing_conduct')),
  version      integer not null check (version >= 1),
  accepted_at  timestamptz not null default now(),
  -- Evidence of the circumstances of the consent; all three may be unknown.
  locale       text check (char_length(locale) between 2 and 35),
  ip_address   inet,
  user_agent   text check (char_length(user_agent) <= 500),
  -- A version is accepted once. Also serves "newest accepted version of a kind" for a
  -- member (session start, world gates) and the foreign key on user_id.
  constraint user_consents_user_kind_version_key unique (user_id, consent_kind, version)
);
comment on table public.user_consents is 'Append-only record of a member''s consents. Written only by server code.';

-- No update at all; a delete only as part of removing the member (the cascade runs after
-- the profile row is gone, a direct delete does not).
create function kc_private.user_consents_append_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.users u where u.id = old.user_id) then
    return old;
  end if;
  raise exception 'append_only' using errcode = 'P0001', detail = 'user_consents';
end;
$$;

create trigger user_consents_append_only
  before update or delete on public.user_consents
  for each row execute function kc_private.user_consents_append_only();

alter table public.user_consents enable row level security;
alter table public.user_consents force row level security;

create policy user_consents_select_self on public.user_consents
  for select to authenticated
  using (user_id = (select auth.uid()));

grant select on public.user_consents to authenticated;

-- The signed-in caller, for RPCs that act on the caller's own data.
create function kc_private.require_caller()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_user_id constant uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  return v_user_id;
end;
$$;
comment on function kc_private.require_caller() is 'Returns auth.uid(); raises unauthenticated without a session.';

-- Records one consent with its evidence and returns the stored row. Recording the same
-- version again keeps the first row. The world modules call this from their own RPCs after
-- checking the version they require.
create function kc_private.record_consent(
  p_user_id uuid, p_kind text, p_version integer, p_locale text, p_user_agent text)
returns public.user_consents
language plpgsql
set search_path = ''
as $$
declare
  -- The API gateway forwards the device address as the first hop of this header.
  v_forwarded constant text := btrim(split_part(
    nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-forwarded-for', ',', 1));
  v_ip inet;
  v_row public.user_consents;
begin
  begin
    v_ip := coalesce(nullif(v_forwarded, '')::inet, inet_client_addr());
  exception when invalid_text_representation then
    v_ip := null;
  end;

  insert into public.user_consents (user_id, consent_kind, version, locale, ip_address, user_agent)
  values (p_user_id, p_kind, p_version, nullif(btrim(p_locale), ''), v_ip, left(p_user_agent, 500))
  on conflict (user_id, consent_kind, version) do nothing;

  select c.* into strict v_row
    from public.user_consents c
   where c.user_id = p_user_id and c.consent_kind = p_kind and c.version = p_version;
  return v_row;
end;
$$;

-- The caller accepts a published version of a legal document (FR-AUTH-002 AC5,
-- FR-SETTINGS-010 AC3/AC4). Only a version that satisfies the consent gate is accepted:
-- from the last material version up to the current one.
create function public.accept_legal_document(
  p_doc_type text, p_version integer, p_locale text default null, p_user_agent text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_caller();
  v_document public.legal_documents;
  v_consent public.user_consents;
begin
  select d.* into v_document from public.legal_documents d where d.doc_type = p_doc_type;
  if not found then
    raise exception 'unknown_legal_document' using errcode = 'P0001';
  end if;
  if p_version is null or p_version < greatest(v_document.last_material_version, 1)
     or p_version > v_document.current_version then
    raise exception 'legal_version_out_of_range' using errcode = 'P0001';
  end if;

  v_consent := kc_private.record_consent(v_user_id, p_doc_type, p_version, p_locale, p_user_agent);
  return jsonb_build_object('acceptance_id', v_consent.id, 'accepted_at', v_consent.accepted_at);
end;
$$;
comment on function public.accept_legal_document(text, integer, text, text) is
  'Records the caller''s consent to a published legal document version.';
grant execute on function public.accept_legal_document(text, integer, text, text) to authenticated;
