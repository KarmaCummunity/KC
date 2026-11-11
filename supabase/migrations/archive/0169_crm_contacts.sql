-- 0169_crm_contacts — V2-ADMIN-CRM-8 — foundation for V2 §13.9 Admin CRM.
--
-- A minimal contacts table the admin team can use to track relationships with
-- donors, partners, journalists, etc. — kept deliberately scoped: contact card +
-- tag list + lifecycle status + free-text notes. Activity / call-log threads
-- land in a follow-up slice if the team needs them.
--
-- Lifecycle: cold → warm → active → inactive (no enforced FSM in v1; the UI
-- lets you set any).

create table if not exists public.crm_contacts (
  contact_id    uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(btrim(name)) between 1 and 200),
  organization  text check (organization is null or char_length(organization) <= 200),
  email         text check (email is null or char_length(email) <= 320),
  phone         text check (phone is null or char_length(phone) <= 32),
  role_title    text check (role_title is null or char_length(role_title) <= 200),
  notes         text check (notes is null or char_length(notes) <= 4000),
  tags          text[] not null default '{}',
  status        text not null default 'cold'
                  check (status in ('cold','warm','active','inactive')),
  last_contacted_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.users(user_id) on delete set null,
  updated_by    uuid references public.users(user_id) on delete set null,
  deleted_at    timestamptz
);

create index if not exists crm_contacts_status_idx
  on public.crm_contacts (status, updated_at desc) where deleted_at is null;

create index if not exists crm_contacts_tags_gin
  on public.crm_contacts using gin (tags) where deleted_at is null;

comment on table public.crm_contacts is
  'V2-ADMIN-CRM-8 — internal admin contacts (donors, partners, journalists). Soft-delete via deleted_at.';

alter table public.crm_contacts enable row level security;

drop policy if exists crm_contacts_select_admin on public.crm_contacts;
create policy crm_contacts_select_admin
  on public.crm_contacts for select to authenticated
  using (
    public.has_admin_role(auth.uid(), 'super_admin')
    or public.has_admin_role(auth.uid(), 'moderator')
  );

-- Writes via SECURITY DEFINER RPCs only.
revoke insert, update, delete on public.crm_contacts from anon, authenticated;
grant select on public.crm_contacts to authenticated;

create or replace function public.crm_contacts_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists crm_contacts_before_update_set_updated_at on public.crm_contacts;
create trigger crm_contacts_before_update_set_updated_at
  before update on public.crm_contacts
  for each row execute function public.crm_contacts_set_updated_at();

-- ── 1. list ─────────────────────────────────────────────────────────────────
create or replace function public.crm_contact_list(
  p_status text default null,
  p_query  text default null,
  p_tag    text default null,
  p_limit  int  default 50,
  p_offset int  default 0
)
returns table (
  contact_id        uuid,
  name              text,
  organization      text,
  email             text,
  phone             text,
  role_title        text,
  notes             text,
  tags              text[],
  status            text,
  last_contacted_at timestamptz,
  created_at        timestamptz,
  updated_at        timestamptz,
  total_count       bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_lim   int  := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_off   int  := greatest(coalesce(p_offset, 0), 0);
  v_total bigint;
  v_q     text := nullif(btrim(coalesce(p_query, '')), '');
begin
  perform admin_assert_role(v_actor, array['super_admin','moderator']);

  if p_status is not null and p_status not in ('cold','warm','active','inactive') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  select count(*) into v_total
    from public.crm_contacts c
   where c.deleted_at is null
     and (p_status is null or c.status = p_status)
     and (p_tag    is null or p_tag = any (c.tags))
     and (
       v_q is null
       or c.name         ilike '%' || v_q || '%'
       or c.organization ilike '%' || v_q || '%'
       or c.email        ilike '%' || v_q || '%'
     );

  return query
  select
    c.contact_id, c.name, c.organization, c.email, c.phone, c.role_title,
    c.notes, c.tags, c.status, c.last_contacted_at,
    c.created_at, c.updated_at, v_total as total_count
  from public.crm_contacts c
  where c.deleted_at is null
    and (p_status is null or c.status = p_status)
    and (p_tag    is null or p_tag = any (c.tags))
    and (
      v_q is null
      or c.name         ilike '%' || v_q || '%'
      or c.organization ilike '%' || v_q || '%'
      or c.email        ilike '%' || v_q || '%'
    )
  order by c.updated_at desc
  limit v_lim offset v_off;
end;
$$;
revoke execute on function public.crm_contact_list(text, text, text, int, int) from public;
grant  execute on function public.crm_contact_list(text, text, text, int, int) to authenticated;

-- ── 2. upsert (create / update via single endpoint, simpler client surface) ──
create or replace function public.crm_contact_upsert(
  p_contact_id  uuid default null,
  p_name        text default null,
  p_organization text default null,
  p_email       text default null,
  p_phone       text default null,
  p_role_title  text default null,
  p_notes       text default null,
  p_tags        text[] default null,
  p_status      text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_id    uuid;
begin
  perform admin_assert_role(v_actor, array['super_admin','moderator']);

  if p_status is not null and p_status not in ('cold','warm','active','inactive') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  if p_contact_id is null then
    -- Create
    if p_name is null or char_length(btrim(p_name)) = 0 then
      raise exception 'invalid_name' using errcode = '22023';
    end if;
    insert into public.crm_contacts (
      name, organization, email, phone, role_title, notes, tags, status,
      created_by, updated_by
    ) values (
      btrim(p_name),
      nullif(btrim(coalesce(p_organization, '')), ''),
      nullif(btrim(coalesce(p_email, '')), ''),
      nullif(btrim(coalesce(p_phone, '')), ''),
      nullif(btrim(coalesce(p_role_title, '')), ''),
      nullif(btrim(coalesce(p_notes, '')), ''),
      coalesce(p_tags, '{}'::text[]),
      coalesce(p_status, 'cold'),
      v_actor, v_actor
    )
    returning contact_id into v_id;
  else
    -- Update
    update public.crm_contacts
       set name         = coalesce(nullif(btrim(coalesce(p_name, '')), ''), name),
           organization = case when p_organization is not null then nullif(btrim(p_organization), '') else organization end,
           email        = case when p_email        is not null then nullif(btrim(p_email), '')        else email end,
           phone        = case when p_phone        is not null then nullif(btrim(p_phone), '')        else phone end,
           role_title   = case when p_role_title   is not null then nullif(btrim(p_role_title), '')   else role_title end,
           notes        = case when p_notes        is not null then nullif(btrim(p_notes), '')        else notes end,
           tags         = coalesce(p_tags, tags),
           status       = coalesce(p_status, status),
           updated_by   = v_actor
     where contact_id = p_contact_id and deleted_at is null
     returning contact_id into v_id;
    if v_id is null then
      raise exception 'contact_not_found' using errcode = 'P0002';
    end if;
  end if;

  return v_id;
end;
$$;
revoke execute on function public.crm_contact_upsert(uuid, text, text, text, text, text, text, text[], text) from public;
grant  execute on function public.crm_contact_upsert(uuid, text, text, text, text, text, text, text[], text) to authenticated;

-- ── 3. soft delete ──────────────────────────────────────────────────────────
create or replace function public.crm_contact_delete(p_contact_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_id    uuid;
begin
  perform admin_assert_role(v_actor, array['super_admin','moderator']);

  update public.crm_contacts
     set deleted_at = now(),
         updated_by = v_actor
   where contact_id = p_contact_id and deleted_at is null
   returning contact_id into v_id;
  if v_id is null then
    raise exception 'contact_not_found' using errcode = 'P0002';
  end if;
end;
$$;
revoke execute on function public.crm_contact_delete(uuid) from public;
grant  execute on function public.crm_contact_delete(uuid) to authenticated;

-- ── 4. mark contacted ──────────────────────────────────────────────────────
create or replace function public.crm_contact_mark_contacted(p_contact_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_id    uuid;
begin
  perform admin_assert_role(v_actor, array['super_admin','moderator']);

  update public.crm_contacts
     set last_contacted_at = now(),
         updated_by = v_actor
   where contact_id = p_contact_id and deleted_at is null
   returning contact_id into v_id;
  if v_id is null then
    raise exception 'contact_not_found' using errcode = 'P0002';
  end if;
end;
$$;
revoke execute on function public.crm_contact_mark_contacted(uuid) from public;
grant  execute on function public.crm_contact_mark_contacted(uuid) to authenticated;
