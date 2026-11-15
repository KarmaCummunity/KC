-- Identity · legal documents (FR-SETTINGS-010)
--
-- Terms of service and privacy policy are published from the server. `legal_documents` is
-- the current pointer of each document; `legal_document_versions` is the immutable history
-- a member's consent refers to. Both are written only by the admin publishing RPC.

create table public.legal_documents (
  id                     uuid primary key default gen_random_uuid(),
  doc_type               text not null unique check (doc_type in ('terms', 'privacy')),
  -- 0 until the first version is published.
  current_version        integer not null default 0 check (current_version >= 0),
  current_effective_date timestamptz not null,
  -- Newest version a member must have accepted: minor edits do not raise it.
  last_material_version  integer not null default 0,
  last_material_severity text check (last_material_severity in ('standard', 'critical')),
  updated_at             timestamptz not null default now(),
  constraint legal_documents_material_version_chk
    check (last_material_version between 0 and current_version)
);
comment on table public.legal_documents is 'Current version pointer of each legal document.';

create trigger legal_documents_set_updated_at
  before update on public.legal_documents
  for each row execute function kc_private.set_updated_at();

create table public.legal_document_versions (
  id             uuid primary key default gen_random_uuid(),
  doc_type       text not null references public.legal_documents (doc_type),
  version        integer not null check (version >= 1),
  -- BCP 47 tag of the text.
  language       text not null default 'he' check (char_length(language) between 2 and 35),
  -- A version published ahead of time is shown, but asks for consent only from this date.
  effective_date timestamptz not null,
  body_md        text not null check (char_length(body_md) > 0),
  -- SHA-256 of body_md, set by trigger: proves which text a consent referred to.
  content_hash   text not null,
  -- minor: no consent needed · standard: 7 days of notice · critical: blocks at once.
  severity       text not null check (severity in ('minor', 'standard', 'critical')),
  change_summary text,
  -- The publishing admin; null once that account has been removed.
  published_by   uuid references public.users (id) on delete set null,
  published_at   timestamptz not null default now(),
  -- Also serves the foreign key on doc_type and "newest version of a document".
  constraint legal_document_versions_doc_version_key unique (doc_type, version),
  constraint legal_document_versions_summary_chk
    check (severity = 'minor' or char_length(btrim(change_summary)) > 0)
);
comment on table public.legal_document_versions is 'Immutable history of published legal texts.';

-- Foreign key lookup when a publisher's account is removed.
create index legal_document_versions_published_by_idx
  on public.legal_document_versions (published_by) where published_by is not null;

-- Stamps the content hash, so it never depends on what the publisher sent.
create function kc_private.legal_document_versions_set_hash()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.content_hash := encode(sha256(convert_to(new.body_md, 'UTF8')), 'hex');
  return new;
end;
$$;

create trigger legal_document_versions_set_hash
  before insert on public.legal_document_versions
  for each row execute function kc_private.legal_document_versions_set_hash();

-- A published version never changes and is never removed. The single exception is the
-- foreign key clearing `published_by` when the publisher's account is removed.
create function kc_private.legal_document_versions_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.published_by is null
     and to_jsonb(new) - 'published_by' = to_jsonb(old) - 'published_by' then
    return new;
  end if;
  raise exception 'append_only' using errcode = 'P0001', detail = 'legal_document_versions';
end;
$$;

create trigger legal_document_versions_immutable
  before update or delete on public.legal_document_versions
  for each row execute function kc_private.legal_document_versions_immutable();

alter table public.legal_documents enable row level security;
alter table public.legal_documents force row level security;
alter table public.legal_document_versions enable row level security;
alter table public.legal_document_versions force row level security;

-- Published legal text is public: the sign-up screen shows the terms and the privacy policy
-- before an account exists (FR-AUTH-002 AC3; PM decision 2026-11-10). This is the only
-- product table a signed-out caller can read.
create policy legal_documents_select_anyone on public.legal_documents
  for select to anon, authenticated
  using (true);

create policy legal_document_versions_select_anyone on public.legal_document_versions
  for select to anon, authenticated
  using (true);

grant select on public.legal_documents to anon, authenticated;
grant select on public.legal_document_versions to anon, authenticated;
