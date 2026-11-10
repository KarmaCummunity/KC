-- Organizations · registration applications and their review (FR-ORG-002, D53, D57, D89)
--
-- A member applies to register an organization; platform staff approve or reject. The
-- approval creates the organization (verified at level 1, D53) and makes the applicant its
-- first org_admin, in one transaction. A decision is final; after a rejection the member
-- may file a new application.

insert into kc_private.fsm_state (machine_id, status) values
  ('org_application', 'pending'), ('org_application', 'approved'), ('org_application', 'rejected');
insert into kc_private.fsm_edge (machine_id, from_status, to_status, role) values
  ('org_application', 'pending', 'approved', 'admin'),
  ('org_application', 'pending', 'rejected', 'admin');

create table public.org_applications (
  id                  uuid primary key default gen_random_uuid(),
  applicant_id        uuid not null references public.users (id) on delete cascade,
  org_name            text not null check (char_length(btrim(org_name)) between 2 and 120),
  org_type            text not null check (org_type in ('nonprofit_association', 'public_benefit_company',
                                                        'public_body', 'informal_initiative', 'private_venture')),
  -- Optional (D89): any non-profit organization may register.
  registration_number text check (registration_number ~ '^[0-9]{5,12}$'),
  org_description     text check (char_length(org_description) <= 4000),
  contact_email       text check (char_length(contact_email) <= 320),
  contact_phone       text check (char_length(contact_phone) <= 20),
  website_url         text check (website_url ~* '^https://' and char_length(website_url) <= 2000),
  -- FR-ORG-002 AC2: the applicant declares that the organization is not for profit.
  declared_nonprofit  boolean not null check (declared_nonprofit),
  -- Lifecycle, machine `org_application`. Never written by a device.
  status              text not null default 'pending',
  reviewed_by         uuid references public.users (id) on delete set null,
  reviewed_at         timestamptz,
  -- Shown to the applicant as written (requirements/20 O4).
  review_note         text check (char_length(review_note) <= 2000),
  -- The organization an approval created.
  organization_id     uuid references public.organizations (id) on delete set null,
  created_at          timestamptz not null default now(),
  constraint org_applications_decision_chk check ((status = 'pending') = (reviewed_at is null))
);
comment on table public.org_applications is 'Applications to register an organization and their review.';

-- A member has one application waiting at a time; also "my applications".
create unique index org_applications_one_pending_key on public.org_applications (applicant_id)
  where status = 'pending';
create index org_applications_applicant_idx on public.org_applications (applicant_id, created_at desc);
-- Staff review queue: by status, oldest first (keyset on created_at, id).
create index org_applications_queue_idx on public.org_applications (status, created_at, id);
-- Foreign keys.
create index org_applications_reviewed_by_idx on public.org_applications (reviewed_by) where reviewed_by is not null;
create index org_applications_organization_idx on public.org_applications (organization_id)
  where organization_id is not null;

create trigger org_applications_status_fsm
  before insert or update of status on public.org_applications
  for each row execute function kc_private.fsm_guard_status('org_application', 'status');

alter table public.org_applications enable row level security;
alter table public.org_applications force row level security;

-- The applicant reads their own applications; platform admins read the queue.
create policy org_applications_select_own on public.org_applications
  for select to authenticated
  using (applicant_id = (select auth.uid()));
create policy org_applications_select_reviewers on public.org_applications
  for select to authenticated
  using ((select kc_access.has_admin_role('admin')));
-- A member with an active account files their own application; the column grant leaves the
-- status and the review fields to the server.
create policy org_applications_insert_own on public.org_applications
  for insert to authenticated
  with check (applicant_id = (select auth.uid())
              and exists (select 1 from public.users u where u.id = (select auth.uid()) and u.is_active));

grant select on public.org_applications to authenticated;
grant insert (id, applicant_id, org_name, org_type, registration_number, org_description, contact_email,
              contact_phone, website_url, declared_nonprofit)
  on public.org_applications to authenticated;

insert into kc_private.notification_kinds (kind, category, title_key, body_key) values
  -- requirements/20 § Data model: the applicant learns the decision.
  ('org_application_decided', 'critical', 'notifications.orgApplicationDecidedTitle',
   'notifications.orgApplicationDecidedBody');

-- Decides a pending application as a platform admin (`org.review_applications`: super
-- admin and admin). Approving needs the slug of the new organization's page. Returns the
-- new organization's id, or null for a rejection.
-- Errors: forbidden (42501); P0001 application_not_found, application_already_decided,
-- slug_required, slug_taken, org_registration_number_taken.
create function kc_private.org_application_decide(p_application_id uuid, p_approve boolean, p_slug text, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.require_admin_role('admin');
  v_application public.org_applications;
  v_org_id uuid;
begin
  select a.* into v_application from public.org_applications a where a.id = p_application_id for update;
  if not found then
    raise exception 'application_not_found' using errcode = 'P0001';
  elsif v_application.status <> 'pending' then
    raise exception 'application_already_decided' using errcode = 'P0001';
  end if;

  if p_approve then
    if nullif(btrim(p_slug), '') is null then
      raise exception 'slug_required' using errcode = 'P0001';
    end if;
    begin
      insert into public.organizations (slug, name, org_type, registration_number, public_about_he, website_url,
                                        contact_email, verification_method, verified_at, verified_by)
      values (btrim(p_slug), btrim(v_application.org_name), v_application.org_type,
              v_application.registration_number, v_application.org_description, v_application.website_url,
              v_application.contact_email, 'manual', now(), v_actor)
      returning id into v_org_id;
    exception when unique_violation then
      raise exception '%', case when exists (select 1 from public.organizations o where o.slug = btrim(p_slug))
                                then 'slug_taken' else 'org_registration_number_taken' end
        using errcode = 'P0001';
    end;
    -- The applicant administers the new organization; the membership row follows the grant.
    insert into public.admin_role_grants (user_id, role, scope_org_id, granted_by, manager_grant_id)
    values (v_application.applicant_id, 'org_admin', v_org_id, v_actor,
            kc_private.admin_granting_grant(v_actor, 'org_admin', v_org_id));
  end if;

  perform set_config('kc.fsm_role', 'admin', true);
  update public.org_applications a
     set status = case when p_approve then 'approved' else 'rejected' end,
         reviewed_by = v_actor, reviewed_at = now(), review_note = nullif(btrim(p_note), ''),
         organization_id = v_org_id
   where a.id = p_application_id;
  perform set_config('kc.fsm_role', '', true);

  perform kc_private.audit_record(
    case when p_approve then 'org_application_approve' else 'org_application_reject' end,
    'org_application', p_application_id,
    jsonb_build_object('applicant_id', v_application.applicant_id, 'organization_id', v_org_id));
  perform kc_private.outbox_enqueue('notification', jsonb_build_object(
    'kind', 'org_application_decided', 'recipient_id', v_application.applicant_id, 'actor_id', null,
    'entity', jsonb_build_object('type', 'org_application', 'id', p_application_id),
    'data', jsonb_build_object('approved', p_approve, 'organization_id', v_org_id,
                               'dedupe_key', 'org_application_decided:' || p_application_id)));
  return v_org_id;
end;
$$;

create function public.admin_org_application_approve(p_application_id uuid, p_slug text, p_note text default null)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select kc_private.org_application_decide(p_application_id, true, p_slug, p_note);
$$;
comment on function public.admin_org_application_approve(uuid, text, text) is
  'Platform admin: approves an application, creating the organization and its first org_admin; returns the organization id.';
grant execute on function public.admin_org_application_approve(uuid, text, text) to authenticated;

create function public.admin_org_application_reject(p_application_id uuid, p_note text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  select kc_private.org_application_decide(p_application_id, false, null, p_note);
$$;
comment on function public.admin_org_application_reject(uuid, text) is
  'Platform admin: rejects an application; the note is shown to the applicant.';
grant execute on function public.admin_org_application_reject(uuid, text) to authenticated;

-- Sets the verification of an organization (FR-ORG-019: levels are set by platform admins)
-- and whether it is a verified nonprofit that may receive donations.
-- Errors: forbidden (42501); P0001 org_not_found; 23514 for a level outside 1–5.
create function public.admin_set_org_verification(
  p_org_id uuid,
  p_level smallint,
  p_is_verified_nonprofit boolean,
  p_method text default 'manual'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.require_admin_role('admin');
begin
  update public.organizations o
     set verification_level = p_level, is_verified_nonprofit = p_is_verified_nonprofit,
         verification_method = p_method, verified_at = now(), verified_by = v_actor
   where o.id = p_org_id;
  if not found then
    raise exception 'org_not_found' using errcode = 'P0001';
  end if;
end;
$$;
comment on function public.admin_set_org_verification(uuid, smallint, boolean, text) is
  'Platform admin: sets the verification level and the verified-nonprofit mark of an organization.';
grant execute on function public.admin_set_org_verification(uuid, smallint, boolean, text) to authenticated;

-- Suspends or reinstates an organization (FR-ORG roles: platform admins).
-- Errors: forbidden (42501); P0001 org_not_found, unknown_state, illegal_transition.
create function public.admin_set_org_status(p_org_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform kc_private.require_admin_role('admin');
  perform set_config('kc.fsm_role', 'admin', true);
  update public.organizations o set status = p_status where o.id = p_org_id;
  if not found then
    raise exception 'org_not_found' using errcode = 'P0001';
  end if;
  perform set_config('kc.fsm_role', '', true);
end;
$$;
comment on function public.admin_set_org_status(uuid, text) is 'Platform admin: suspends or reinstates an organization.';
grant execute on function public.admin_set_org_status(uuid, text) to authenticated;
