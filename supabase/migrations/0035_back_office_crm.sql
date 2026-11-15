-- Back office · CRM contacts per organization (FR-ADMIN-032, product decision in docs/spec/90_decisions_log.md)
--
-- An organization keeps its own contact book: partners, donors, suppliers and other people it
-- works with. Each contact belongs to exactly one organization, and only that organization's
-- managers see or change it. Karma Community is the platform organization and keeps its book
-- the same way, run by platform staff.
--
-- Who may manage an organization's book (kc_private.crm_assert):
--   org_admin and org_manager of the organization (kc_access.managed_org_ids)
--   moderator and above, for the platform organization only
--
-- A deleted contact is hidden (`deleted_at`), not erased. Every write is audited on topic
-- `audit` with ids only; the contact's name, email and phone never enter the trail.
--
-- Errors (P0001 unless noted): invalid_name, invalid_status, invalid_email, invalid_phone,
-- invalid_input, contact_not_found; forbidden is 42501.

create table kc_private.crm_contacts (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations (id) on delete cascade,
  name              text not null check (char_length(btrim(name)) between 1 and 200),
  -- The contact's own organization or company (free text), not the owning organization.
  organization      text check (char_length(organization) <= 200),
  email             text check (email ~ '^[^@\s]+@[^@\s]+$' and char_length(email) <= 320),
  phone             text check (phone ~ '^[+0-9 ()-]{3,32}$'),
  role_title        text check (char_length(role_title) <= 200),
  notes             text check (char_length(notes) <= 4000),
  tags              text[] not null default '{}' check (cardinality(tags) <= 30),
  status            text not null default 'cold' check (status in ('cold', 'warm', 'active', 'inactive')),
  last_contacted_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references public.users (id) on delete set null,
  updated_by        uuid references public.users (id) on delete set null,
  deleted_at        timestamptz
);
comment on table kc_private.crm_contacts is
  'Contact book of an organization (FR-ADMIN-032). Reached only through the crm_* RPCs.';

-- The list of one organization, most recently updated first (keyset).
create index crm_contacts_org_list_idx on kc_private.crm_contacts (org_id, updated_at desc, id desc)
  where deleted_at is null;
create index crm_contacts_tags_idx on kc_private.crm_contacts using gin (tags) where deleted_at is null;
create index crm_contacts_created_by_idx on kc_private.crm_contacts (created_by) where created_by is not null;
create index crm_contacts_updated_by_idx on kc_private.crm_contacts (updated_by) where updated_by is not null;

alter table kc_private.crm_contacts enable row level security;
alter table kc_private.crm_contacts force row level security;

create trigger crm_contacts_set_updated_at
  before update on kc_private.crm_contacts
  for each row execute function kc_private.set_updated_at();

-- ── Access ──────────────────────────────────────────────────────────────────
-- True when the caller may manage the organization's contact book.
create function kc_private.crm_can_manage(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_org_id = any (kc_access.managed_org_ids())
      or (kc_access.has_admin_role('moderator')
          and exists (select 1 from public.organizations o where o.id = p_org_id and o.is_platform));
$$;

-- Returns the signed-in caller; raises forbidden unless they manage the organization's book.
create function kc_private.crm_assert(p_org_id uuid)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_user_id constant uuid := kc_private.require_active_caller();
begin
  if p_org_id is null or not kc_private.crm_can_manage(p_org_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return v_user_id;
end;
$$;

-- Locks a live contact and checks the caller manages its organization.
create function kc_private.crm_contact_lock(p_contact_id uuid)
returns kc_private.crm_contacts
language plpgsql
set search_path = ''
as $$
declare
  v_contact kc_private.crm_contacts;
begin
  select * into v_contact from kc_private.crm_contacts c
   where c.id = p_contact_id and c.deleted_at is null for update;
  if not found then
    raise exception 'contact_not_found' using errcode = 'P0001';
  end if;
  perform kc_private.crm_assert(v_contact.org_id);
  return v_contact;
end;
$$;

create function kc_private.crm_audit(p_action text, p_contact kc_private.crm_contacts, p_actor uuid, p_data jsonb)
returns void
language sql
set search_path = ''
as $$
  select kc_private.outbox_enqueue('audit', jsonb_build_object(
    'action', p_action, 'actor_id', p_actor,
    'entity', jsonb_build_object('type', 'crm_contact', 'id', p_contact.id),
    'data', jsonb_build_object('org_id', p_contact.org_id) || p_data));
$$;

-- A patch value: null keeps the current value, an empty or blank string clears it.
create function kc_private.crm_patch(p_value text, p_current text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_value is null then p_current else nullif(btrim(p_value), '') end;
$$;

-- Raises the CRM error code for a value the table would refuse.
create function kc_private.crm_check(p_contact kc_private.crm_contacts)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_contact.name is null or char_length(p_contact.name) not between 1 and 200 then
    raise exception 'invalid_name' using errcode = 'P0001';
  end if;
  if p_contact.status not in ('cold', 'warm', 'active', 'inactive') then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
  if p_contact.email is not null and (p_contact.email !~ '^[^@\s]+@[^@\s]+$' or char_length(p_contact.email) > 320) then
    raise exception 'invalid_email' using errcode = 'P0001';
  end if;
  if p_contact.phone is not null and p_contact.phone !~ '^[+0-9 ()-]{3,32}$' then
    raise exception 'invalid_phone' using errcode = 'P0001';
  end if;
  if char_length(p_contact.organization) > 200 or char_length(p_contact.role_title) > 200
     or char_length(p_contact.notes) > 4000 or cardinality(p_contact.tags) > 30 then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
end;
$$;

-- ── RPCs ────────────────────────────────────────────────────────────────────
-- The organizations whose contact book the caller manages, the platform organization first.
create function public.crm_my_orgs()
returns table (org_id uuid, name text, is_platform boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.name, o.is_platform
    from public.organizations o
   where kc_private.crm_can_manage(o.id)
   order by o.is_platform desc, o.name, o.id;
$$;
comment on function public.crm_my_orgs() is 'The organizations whose CRM contact book the caller manages.';
grant execute on function public.crm_my_orgs() to authenticated;

-- Creates a contact (p_contact_id null; the name is required and the status defaults to
-- cold) or patches one of the organization (null keeps a field, an empty string clears it).
-- Returns the contact id.
create function public.crm_contact_upsert(
  p_org_id uuid,
  p_contact_id uuid default null,
  p_name text default null,
  p_organization text default null,
  p_email text default null,
  p_phone text default null,
  p_role_title text default null,
  p_notes text default null,
  p_tags text[] default null,
  p_status text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.crm_assert(p_org_id);
  v_old kc_private.crm_contacts;
  v_new kc_private.crm_contacts;
  v_fields jsonb;
begin
  if p_contact_id is null then
    v_old := row(null, p_org_id, null, null, null, null, null, null, '{}', 'cold', null, null, null, null, null, null)::kc_private.crm_contacts;
  else
    v_old := kc_private.crm_contact_lock(p_contact_id);
    if v_old.org_id <> p_org_id then
      raise exception 'contact_not_found' using errcode = 'P0001';
    end if;
  end if;
  v_new := v_old;
  v_new.name := case when p_name is null then v_old.name else btrim(p_name) end;
  v_new.organization := kc_private.crm_patch(p_organization, v_old.organization);
  v_new.email := kc_private.crm_patch(p_email, v_old.email);
  v_new.phone := kc_private.crm_patch(p_phone, v_old.phone);
  v_new.role_title := kc_private.crm_patch(p_role_title, v_old.role_title);
  v_new.notes := kc_private.crm_patch(p_notes, v_old.notes);
  v_new.tags := coalesce(p_tags, v_old.tags);
  v_new.status := coalesce(p_status, v_old.status);
  perform kc_private.crm_check(v_new);

  if p_contact_id is null then
    insert into kc_private.crm_contacts (org_id, name, organization, email, phone, role_title, notes, tags, status,
                                         created_by, updated_by)
    values (p_org_id, v_new.name, v_new.organization, v_new.email, v_new.phone, v_new.role_title, v_new.notes,
            v_new.tags, v_new.status, v_actor, v_actor)
    returning * into v_new;
    perform kc_private.crm_audit('crm_contact_create', v_new, v_actor, jsonb_build_object('status', v_new.status));
    return v_new.id;
  end if;

  select coalesce(jsonb_agg(f.field), '[]') into v_fields
    from (values ('name', v_old.name is distinct from v_new.name),
                 ('organization', v_old.organization is distinct from v_new.organization),
                 ('email', v_old.email is distinct from v_new.email),
                 ('phone', v_old.phone is distinct from v_new.phone),
                 ('role_title', v_old.role_title is distinct from v_new.role_title),
                 ('notes', v_old.notes is distinct from v_new.notes),
                 ('tags', v_old.tags is distinct from v_new.tags),
                 ('status', v_old.status is distinct from v_new.status)) f(field, changed)
   where f.changed;
  if jsonb_array_length(v_fields) > 0 then
    update kc_private.crm_contacts c
       set name = v_new.name, organization = v_new.organization, email = v_new.email, phone = v_new.phone,
           role_title = v_new.role_title, notes = v_new.notes, tags = v_new.tags, status = v_new.status,
           updated_by = v_actor
     where c.id = p_contact_id;
    perform kc_private.crm_audit('crm_contact_update', v_new, v_actor, jsonb_build_object('fields', v_fields));
  end if;
  return p_contact_id;
end;
$$;
comment on function public.crm_contact_upsert(uuid, uuid, text, text, text, text, text, text, text[], text) is
  'Organization managers: creates or patches a contact of the organization''s CRM book.';
grant execute on function public.crm_contact_upsert(uuid, uuid, text, text, text, text, text, text, text[], text)
  to authenticated;

-- Hides a contact from the book.
create function public.crm_contact_delete(p_contact_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact constant kc_private.crm_contacts := kc_private.crm_contact_lock(p_contact_id);
begin
  update kc_private.crm_contacts c set deleted_at = now(), updated_by = auth.uid() where c.id = p_contact_id;
  perform kc_private.crm_audit('crm_contact_delete', v_contact, auth.uid(), '{}'::jsonb);
end;
$$;
comment on function public.crm_contact_delete(uuid) is 'Organization managers: hides a contact from the CRM book.';
grant execute on function public.crm_contact_delete(uuid) to authenticated;

-- Records that the organization was in touch with the contact now.
create function public.crm_contact_mark_contacted(p_contact_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact constant kc_private.crm_contacts := kc_private.crm_contact_lock(p_contact_id);
begin
  update kc_private.crm_contacts c set last_contacted_at = now(), updated_by = auth.uid() where c.id = p_contact_id;
  perform kc_private.crm_audit('crm_contact_contacted', v_contact, auth.uid(), '{}'::jsonb);
end;
$$;
comment on function public.crm_contact_mark_contacted(uuid) is 'Organization managers: stamps the last contact time.';
grant execute on function public.crm_contact_mark_contacted(uuid) to authenticated;

-- True when the contact matches the list filters (the query is a case-insensitive substring of
-- the name, the contact's organization or the email).
create function kc_private.crm_matches(p_contact kc_private.crm_contacts, p_status text, p_query text, p_tag text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_status is null or p_contact.status = p_status)
     and (p_tag is null or p_contact.tags @> array[p_tag])
     and (nullif(btrim(p_query), '') is null
          or strpos(lower(concat_ws(' ', p_contact.name, p_contact.organization, p_contact.email)),
                    lower(btrim(p_query))) > 0);
$$;

create function kc_private.crm_assert_status(p_status text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_status is not null and p_status not in ('cold', 'warm', 'active', 'inactive') then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
end;
$$;

-- The organization's live contacts, most recently updated first, keyset-paged: each row
-- carries the `cursor` that continues after it.
create function public.crm_contact_list(
  p_org_id uuid,
  p_status text default null,
  p_query text default null,
  p_tag text default null,
  p_limit integer default 50,
  p_cursor jsonb default null
)
returns table (contact jsonb, cursor jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_updated constant timestamptz := (p_cursor ->> 'updated_at')::timestamptz;
  v_id constant uuid := (p_cursor ->> 'id')::uuid;
begin
  perform kc_private.crm_assert(p_org_id);
  perform kc_private.crm_assert_status(p_status);
  return query
  select jsonb_build_object(
           'contact_id', c.id, 'name', c.name, 'organization', c.organization, 'email', c.email,
           'phone', c.phone, 'role_title', c.role_title, 'notes', c.notes, 'tags', to_jsonb(c.tags),
           'status', c.status, 'last_contacted_at', c.last_contacted_at,
           'created_at', c.created_at, 'updated_at', c.updated_at),
         jsonb_build_object('updated_at', c.updated_at, 'id', c.id)
    from kc_private.crm_contacts c
   where c.org_id = p_org_id and c.deleted_at is null
     and kc_private.crm_matches(c, p_status, p_query, p_tag)
     and (p_cursor is null or (c.updated_at, c.id) < (v_updated, v_id))
   order by c.updated_at desc, c.id desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;
comment on function public.crm_contact_list(uuid, text, text, text, integer, jsonb) is
  'Organization managers: the CRM contacts of the organization, keyset-paged by the returned cursor.';
grant execute on function public.crm_contact_list(uuid, text, text, text, integer, jsonb) to authenticated;

-- How many live contacts match the same filters (the screen's total).
create function public.crm_contact_count(
  p_org_id uuid,
  p_status text default null,
  p_query text default null,
  p_tag text default null
)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform kc_private.crm_assert(p_org_id);
  perform kc_private.crm_assert_status(p_status);
  return (select count(*) from kc_private.crm_contacts c
           where c.org_id = p_org_id and c.deleted_at is null
             and kc_private.crm_matches(c, p_status, p_query, p_tag));
end;
$$;
comment on function public.crm_contact_count(uuid, text, text, text) is
  'Organization managers: the number of CRM contacts matching the list filters.';
grant execute on function public.crm_contact_count(uuid, text, text, text) to authenticated;
