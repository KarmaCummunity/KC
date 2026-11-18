-- Employment · a job offer is published only in the name of an organization allowed to employ
--
-- docs/spec/05_giving_worlds.md §5.11 (D100, PM 2026-11-16, #1476): only a verified
-- organization that may legally employ people posts jobs, and Karma Community itself (the
-- platform organization). Until the organization verification levels (FR-ORG-017..020)
-- record that fact, a platform admin switches it on per organization (`may_post_jobs`).
-- Looking for work (`employment/job_request`) stays open to every member.
--
-- The rule is enforced when a job offer is open: a draft may be prepared before it names
-- its organization, and publishing, inserting it open or detaching its organization later
-- are all refused (job_offer_org_required). Moderation and system sweeps that return a post
-- to open are not re-judged, as with the open-post quota. Turning the switch off does not
-- close job offers that are already open.

-- ── The organization's permission ─────────────────────────────────────────
alter table public.organizations
  add column may_post_jobs boolean not null default false;
comment on column public.organizations.may_post_jobs is
  'Set by platform admins: the organization may legally employ and publishes job offers (§5.11, #1476).';

-- May this organization publish job offers? An active organization that a platform admin
-- allowed, or the platform organization itself.
create function kc_private.org_may_post_jobs(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.organizations o
     where o.id = p_org_id and o.status = 'active' and (o.is_platform or o.may_post_jobs));
$$;
comment on function kc_private.org_may_post_jobs(uuid) is
  'The organization is active and may publish job offers: the platform organization or one a platform admin allowed.';

-- Platform admin: allows or stops an organization publishing job offers (audited).
-- Errors: forbidden (42501); P0001 org_not_found.
create function public.admin_set_org_may_post_jobs(p_org_id uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform kc_private.require_admin_role('admin');
  update public.organizations o set may_post_jobs = p_enabled where o.id = p_org_id;
  if not found then
    raise exception 'org_not_found' using errcode = 'P0001';
  end if;
end;
$$;
comment on function public.admin_set_org_may_post_jobs(uuid, boolean) is
  'Platform admin: allows or stops an organization publishing job offers (§5.11, #1476).';
grant execute on function public.admin_set_org_may_post_jobs(uuid, boolean) to authenticated;

-- ── Audit: the permission is a privileged fact like the verification ─────────
create or replace function kc_private.audit_organization()
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
         when old.may_post_jobs <> new.may_post_jobs then 'org_job_posting_set'
         else 'org_verification_set' end,
    'organization', new.id,
    jsonb_build_object('status', new.status, 'verification_level', new.verification_level,
                       'is_verified_nonprofit', new.is_verified_nonprofit, 'sec46_status', new.sec46_status,
                       'may_post_jobs', new.may_post_jobs));
  return null;
end;
$$;

drop trigger organizations_audit_update on public.organizations;
create trigger organizations_audit_update
  after update of status, verification_level, is_verified_nonprofit, sec46_status, sec46_valid_until, may_post_jobs
  on public.organizations
  for each row
  when ((old.status, old.verification_level, old.is_verified_nonprofit, old.sec46_status, old.sec46_valid_until,
         old.may_post_jobs)
        is distinct from
        (new.status, new.verification_level, new.is_verified_nonprofit, new.sec46_status, new.sec46_valid_until,
         new.may_post_jobs))
  execute function kc_private.audit_organization();

-- ── The rule on posts ──────────────────────────────────────────────────────
-- An open job offer names an organization that may publish job offers. Runs on every way a
-- post becomes or stays an open job offer: insert, status change, organization change.
create function kc_private.posts_guard_job_offer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'open'
     or coalesce(current_setting('kc.fsm_role', true), '') in ('admin', 'system')
     or not exists (select 1 from public.post_kinds k
                     where k.id = new.kind_id and k.world_slug = 'employment' and k.slug = 'job_offer') then
    return new;
  end if;
  if new.beneficiary_org_id is null or not kc_private.org_may_post_jobs(new.beneficiary_org_id) then
    raise exception 'job_offer_org_required' using errcode = 'P0001',
      detail = 'a job offer is published in the name of an organization allowed to post jobs';
  end if;
  return new;
end;
$$;
comment on function kc_private.posts_guard_job_offer() is
  'BEFORE INSERT OR UPDATE on posts: an open employment job offer names an organization allowed to post jobs.';

create trigger posts_guard_job_offer
  before insert or update of status, beneficiary_org_id, kind_id on public.posts
  for each row execute function kc_private.posts_guard_job_offer();
