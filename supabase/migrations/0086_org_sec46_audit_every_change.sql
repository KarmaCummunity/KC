-- Organizations · every change of the Section 46(a) record is audited as one (KC#1695)
--
-- FR-FIN-005 AC4 asks for an audit row per finance write. The organization audit trigger
-- (last redefined by the employment job-offer migration, which added `may_post_jobs`)
-- watched the Section 46(a) status and end date only, and named a write by the status
-- alone, so:
--   * a renewal (same status, new dates) was recorded as `org_verification_set`;
--   * a corrected approval number or start date alone was not recorded at all.
-- The trigger now watches the whole record (status, number, both dates) and names any
-- change of it `finance_sec46_set`. Everything else is unchanged: a change of the
-- organization's own status still wins, and the job-posting permission keeps its action.

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
         when (old.sec46_status, old.sec46_approval_number, old.sec46_valid_from, old.sec46_valid_until)
              is distinct from
              (new.sec46_status, new.sec46_approval_number, new.sec46_valid_from, new.sec46_valid_until)
           then 'finance_sec46_set'
         when old.may_post_jobs <> new.may_post_jobs then 'org_job_posting_set'
         else 'org_verification_set' end,
    'organization', new.id,
    jsonb_build_object('status', new.status, 'verification_level', new.verification_level,
                       'is_verified_nonprofit', new.is_verified_nonprofit, 'sec46_status', new.sec46_status,
                       'may_post_jobs', new.may_post_jobs));
  return null;
end;
$$;

-- The column list and the WHEN clause gain the approval number and the start date.
drop trigger organizations_audit_update on public.organizations;
create trigger organizations_audit_update
  after update of status, verification_level, is_verified_nonprofit,
    sec46_status, sec46_approval_number, sec46_valid_from, sec46_valid_until, may_post_jobs
  on public.organizations
  for each row
  when ((old.status, old.verification_level, old.is_verified_nonprofit,
         old.sec46_status, old.sec46_approval_number, old.sec46_valid_from, old.sec46_valid_until,
         old.may_post_jobs)
        is distinct from
        (new.status, new.verification_level, new.is_verified_nonprofit,
         new.sec46_status, new.sec46_approval_number, new.sec46_valid_from, new.sec46_valid_until,
         new.may_post_jobs))
  execute function kc_private.audit_organization();
