-- Organizations · Section 46(a) status on the FSM kernel (FR-FIN-007 AC2–AC3)
--
-- `organizations.sec46_status` decides whether a donation receipt carries the tax notice
-- (billing.receipts), and it was the one stored status without a graph: the record RPC
-- wrote any status over any other, and nothing ever wrote `expired`, so an approval whose
-- validity had passed stayed `active` in the record.
--
--   1. Machine `org_sec46`, guarded on the column like every other status.
--   2. `finance_sec46_set` records what the organization holds, inside the graph. `expired`
--      is not recorded by hand: it is what an `active` approval becomes when its validity
--      ends (step 3). An approval recorded as `active` must be valid today.
--   3. `kc_private.org_tax_approval_expire()`, nightly: `active → expired` once `sec46_valid_until`
--      has passed (Israel date). The number and the dates stay on the record.
--
-- Errors of the RPC: forbidden (42501), illegal_transition / forbidden_role (the kernel),
-- sec46_not_valid_today (P0001), and the table's own checks (23514).

insert into kc_private.fsm_state (machine_id, status) values
  ('org_sec46', 'none'), ('org_sec46', 'pending'), ('org_sec46', 'active'),
  ('org_sec46', 'expired'), ('org_sec46', 'revoked');

-- An organization records its own approval (the platform never decides eligibility), so
-- every edge but one is open to whoever may manage its finances. Expiry is the server's.
insert into kc_private.fsm_edge (machine_id, from_status, to_status, role) values
  -- Applying, and withdrawing the application.
  ('org_sec46', 'none', 'pending', ''),
  ('org_sec46', 'pending', 'none', ''),
  -- The approval is granted: from nothing, from an application, or again after it lapsed.
  ('org_sec46', 'none', 'active', ''),
  ('org_sec46', 'pending', 'active', ''),
  ('org_sec46', 'expired', 'active', ''),
  ('org_sec46', 'revoked', 'active', ''),
  -- The validity ended (nightly job only).
  ('org_sec46', 'active', 'expired', 'system'),
  -- The Tax Authority revoked it, or the record was a mistake.
  ('org_sec46', 'active', 'revoked', ''),
  ('org_sec46', 'active', 'none', ''),
  -- A renewal is being processed, or the organization gave the approval up.
  ('org_sec46', 'expired', 'pending', ''),
  ('org_sec46', 'revoked', 'pending', ''),
  ('org_sec46', 'expired', 'none', ''),
  ('org_sec46', 'revoked', 'none', '');

create trigger organizations_sec46_status_fsm
  before insert or update of sec46_status on public.organizations
  for each row execute function kc_private.fsm_guard_status('org_sec46', 'sec46_status');

-- Records the Section 46(a) approval of an organization (FR-FIN-007 AC2). `none` and
-- `pending` clear the number and the dates; `active` needs all three (table constraint)
-- and a validity that has not ended; `revoked` keeps what was recorded unless new values
-- are given. Recording `active` again with new dates is a renewal (no status move).
create or replace function public.finance_sec46_set(
  p_org_id uuid,
  p_status text,
  p_approval_number text default null,
  p_valid_from date default null,
  p_valid_until date default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today constant date := (now() at time zone 'Asia/Jerusalem')::date;
begin
  perform kc_private.finance_assert(p_org_id, 'manage');
  if p_status = 'active' and p_valid_until < v_today then
    raise exception 'sec46_not_valid_today' using errcode = 'P0001';
  end if;
  update public.organizations o
     set sec46_status = p_status,
         sec46_approval_number = case
           when p_status in ('none', 'pending') then null
           when p_status = 'active' then p_approval_number
           else coalesce(p_approval_number, o.sec46_approval_number) end,
         sec46_valid_from = case
           when p_status in ('none', 'pending') then null
           when p_status = 'active' then p_valid_from
           else coalesce(p_valid_from, o.sec46_valid_from) end,
         sec46_valid_until = case
           when p_status in ('none', 'pending') then null
           when p_status = 'active' then p_valid_until
           else coalesce(p_valid_until, o.sec46_valid_until) end
   where o.id = p_org_id;
end;
$$;
comment on function public.finance_sec46_set(uuid, text, text, date, date) is
  'Finance managers: records the Section 46(a) approval an organization holds, along the org_sec46 machine.';

-- Marks every approval whose validity ended as expired; returns how many. The record keeps
-- its number and dates, so an old receipt still reads against the validity it was issued in.
-- (A job command names a function of letters and underscores only, hence "tax approval".)
create function kc_private.org_tax_approval_expire()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today constant date := (now() at time zone 'Asia/Jerusalem')::date;
  v_count integer;
begin
  perform set_config('kc.fsm_role', 'system', true);
  update public.organizations o
     set sec46_status = 'expired'
   where o.sec46_status = 'active' and o.sec46_valid_until < v_today;
  get diagnostics v_count = row_count;
  perform set_config('kc.fsm_role', '', true);
  return v_count;
end;
$$;
comment on function kc_private.org_tax_approval_expire() is
  'Nightly: an active Section 46(a) approval whose validity ended becomes expired.';

insert into kc_private.scheduled_jobs (name, schedule, command, timeout, alert_after, description) values
  ('org_tax_approval_expire', '10 22 * * *', 'select kc_private.org_tax_approval_expire()',
   interval '2 minutes', interval '36 hours', 'Section 46(a) approvals whose validity ended become expired.');
