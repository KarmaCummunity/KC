-- Organizations · organizations (spec 08, requirements/20 FR-ORG-001, requirements/19 FR-FIN-007/022)
--
-- One row per organization; Karma Community itself is the platform organization (D76).
-- The row is the public profile: nothing on it is private, so every signed-in member may
-- read an active organization. Three independent facts live here and are written only by
-- server code: the lifecycle status, the verification (D53) and the Section 46(a) approval
-- the organization holds (D77 — recorded, never decided by the product).
-- Not part of this baseline (FR-ORG phase 1–3, not built): organization sign-in accounts,
-- acting as an organization, following organizations, claiming catalog entries.

insert into kc_private.fsm_state (machine_id, status) values
  ('organization', 'active'), ('organization', 'suspended');
-- Only platform staff suspend and reinstate an organization (FR-ORG roles).
insert into kc_private.fsm_edge (machine_id, from_status, to_status, role) values
  ('organization', 'active', 'suspended', 'admin'),
  ('organization', 'suspended', 'active', 'admin');

create table public.organizations (
  id                    uuid primary key default gen_random_uuid(),
  -- Stable identifier of the public page link.
  slug                  text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+){0,9}$' and char_length(slug) <= 60),
  name                  text not null check (char_length(btrim(name)) between 2 and 120),
  -- The organization that runs the product; exactly one row.
  is_platform           boolean not null default false,
  -- D57 / D89: a private person may register; the registration number is optional.
  org_type              text check (org_type in ('nonprofit_association', 'public_benefit_company', 'public_body',
                                                 'informal_initiative', 'private_venture')),
  registration_number   text check (registration_number ~ '^[0-9]{5,12}$'),
  -- Lifecycle, machine `organization`. A suspended organization is hidden from members.
  status                text not null default 'active',
  -- D53: 1 basic (the registration condition) … 5 effectiveness. Set by platform staff.
  verification_level    smallint not null default 1 check (verification_level between 1 and 5),
  verification_method   text check (verification_method in ('manual', 'document', 'registrar')),
  verified_at           timestamptz,
  verified_by           uuid references public.users (id) on delete set null,
  -- A verified nonprofit may receive donations through the product (D4, D20).
  is_verified_nonprofit boolean not null default false,
  -- Public profile texts, Hebrew and English.
  public_tagline_he     text check (char_length(public_tagline_he) <= 160),
  public_tagline_en     text check (char_length(public_tagline_en) <= 160),
  public_about_he       text check (char_length(public_about_he) <= 4000),
  public_about_en       text check (char_length(public_about_en) <= 4000),
  website_url           text check (website_url ~* '^https://' and char_length(website_url) <= 2000),
  contact_email         text check (char_length(contact_email) <= 320),
  city_id               text references public.cities (city_id),
  -- Section 46(a) approval held by the organization (FR-FIN-007). `active` needs the
  -- approval number and both dates; a receipt is tax-eligible only inside the validity.
  sec46_status          text not null default 'none'
                          check (sec46_status in ('none', 'pending', 'active', 'expired', 'revoked')),
  sec46_approval_number text check (char_length(sec46_approval_number) between 1 and 40),
  sec46_valid_from      date,
  sec46_valid_until     date,
  -- Which live finance blocks the public page shows (FR-FIN-022, D111). All off by default.
  show_totals             boolean not null default false,
  show_donations_count    boolean not null default false,
  show_program_ratio      boolean not null default false,
  show_category_breakdown boolean not null default false,
  show_monthly_trend      boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint organizations_sec46_active_chk check (
    sec46_status <> 'active'
    or (sec46_approval_number is not null and sec46_valid_from is not null
        and sec46_valid_until >= sec46_valid_from)),
  constraint organizations_verified_chk check ((verified_at is null) = (verification_method is null))
);
comment on table public.organizations is
  'Organizations and their public profile, verification and Section 46(a) record. Karma Community is the platform organization.';

-- There is one platform organization.
create unique index organizations_single_platform_key on public.organizations (is_platform) where is_platform;
-- FR-ORG-002 AC3: a registration number belongs to one organization.
create unique index organizations_registration_number_key on public.organizations (registration_number)
  where registration_number is not null;
-- Money hub list of verified nonprofits, by name (keyset on name, id).
create index organizations_verified_nonprofit_idx on public.organizations (name, id)
  where is_verified_nonprofit and status = 'active';
-- Organization search by name (substring match).
create index organizations_name_trgm_idx on public.organizations using gin (name extensions.gin_trgm_ops);
-- Foreign keys.
create index organizations_city_idx on public.organizations (city_id) where city_id is not null;
create index organizations_verified_by_idx on public.organizations (verified_by) where verified_by is not null;

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function kc_private.set_updated_at();
create trigger organizations_status_fsm
  before insert or update of status on public.organizations
  for each row execute function kc_private.fsm_guard_status('organization', 'status');

alter table public.organizations enable row level security;
alter table public.organizations force row level security;

-- Every signed-in member reads active organizations. Members of a suspended organization
-- and platform staff read it too (policies in 020_org_memberships.sql). Nothing for
-- signed-out callers (design §12.1).
create policy organizations_select_active on public.organizations
  for select to authenticated
  using (status = 'active');

grant select on public.organizations to authenticated;
-- Profile texts only; who may edit them is decided by the policy of the memberships file.
-- Name, slug, type, status, verification, Section 46(a) and the finance switches change
-- through RPCs.
grant update (public_tagline_he, public_tagline_en, public_about_he, public_about_en, website_url,
              contact_email, city_id)
  on public.organizations to authenticated;

-- The privileged facts of an organization are audited whoever writes them: its creation,
-- status, verification and Section 46(a) record.
create function kc_private.audit_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform kc_private.audit_record(
    case when tg_op = 'INSERT' then 'org_create'
         when old.status <> new.status then 'org_status_changed'
         when old.sec46_status <> new.sec46_status then 'finance_sec46_set'
         else 'org_verification_set' end,
    'organization', new.id,
    jsonb_build_object('status', new.status, 'verification_level', new.verification_level,
                       'is_verified_nonprofit', new.is_verified_nonprofit, 'sec46_status', new.sec46_status));
  return null;
end;
$$;

create trigger organizations_audit_insert
  after insert on public.organizations
  for each row execute function kc_private.audit_organization();
create trigger organizations_audit_update
  after update of status, verification_level, is_verified_nonprofit, sec46_status, sec46_valid_until
  on public.organizations
  for each row
  when ((old.status, old.verification_level, old.is_verified_nonprofit, old.sec46_status, old.sec46_valid_until)
        is distinct from
        (new.status, new.verification_level, new.is_verified_nonprofit, new.sec46_status, new.sec46_valid_until))
  execute function kc_private.audit_organization();
