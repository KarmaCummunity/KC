-- 0168_org_applications — V2-ADMIN-ORG-7 — foundation for V2 §13.12 Org Approvals.
--
-- New table that tracks NGO / organization applications submitted by users.
-- Admins can list pending applications and approve / reject each one. The
-- decision flow is the only path we ship in this PR; the actual side-effect
-- of "create an Organization entity on approve" is deferred — there is no
-- `organizations` table yet, and building one is a separate slice. For now
-- approval is purely a status flip + audit trail.
--
-- Three RPCs:
--   admin_org_application_list(p_status, p_limit, p_offset)
--   admin_org_application_approve(p_application_id, p_note)
--   admin_org_application_reject(p_application_id, p_note)
--
-- Audit-event actions extended with:
--   org_application_approve / org_application_reject

-- ── 1. table ─────────────────────────────────────────────────────────────────
create table if not exists public.org_applications (
  application_id   uuid primary key default gen_random_uuid(),
  applicant_user_id uuid not null references public.users(user_id) on delete cascade,
  org_name         text not null check (char_length(btrim(org_name)) between 2 and 200),
  org_description  text check (org_description is null or char_length(org_description) <= 4000),
  contact_email    text check (contact_email is null or char_length(contact_email) <= 320),
  contact_phone    text check (contact_phone is null or char_length(contact_phone) <= 20),
  website_url      text check (website_url is null or char_length(website_url) <= 2000),
  status           text not null default 'pending'
                     check (status in ('pending','approved','rejected')),
  created_at       timestamptz not null default now(),
  reviewed_at      timestamptz null,
  reviewed_by      uuid null references public.users(user_id) on delete set null,
  review_note      text check (review_note is null or char_length(review_note) <= 2000)
);

create index if not exists org_applications_status_idx
  on public.org_applications (status, created_at desc);

create index if not exists org_applications_applicant_idx
  on public.org_applications (applicant_user_id);

comment on table public.org_applications is
  'V2-ADMIN-ORG-7 — pending / decided NGO applications. Approval side-effects (creating an Organization) land in a separate slice.';

alter table public.org_applications enable row level security;

-- Self-read: an applicant can see their own submissions.
drop policy if exists org_applications_select_self on public.org_applications;
create policy org_applications_select_self
  on public.org_applications for select to authenticated
  using (applicant_user_id = auth.uid());

-- Admin-read: super_admin / moderator can see everything.
drop policy if exists org_applications_select_admin on public.org_applications;
create policy org_applications_select_admin
  on public.org_applications for select to authenticated
  using (
    public.has_admin_role(auth.uid(), 'super_admin')
    or public.has_admin_role(auth.uid(), 'moderator')
  );

-- Writes via SECURITY DEFINER RPCs only.
revoke insert, update, delete on public.org_applications from anon, authenticated;
grant select on public.org_applications to authenticated;

-- ── 2. audit_events.action allow-list extension ─────────────────────────────
alter table public.audit_events
  drop constraint if exists audit_events_action_check;

alter table public.audit_events
  add constraint audit_events_action_check_v6 check (action in (
    'block_user','unblock_user',
    'report_target',
    'auto_remove_target','manual_remove_target','restore_target',
    'suspend_user','unsuspend_user',
    'ban_user',
    'false_report_sanction_applied',
    'dismiss_report','confirm_report',
    'delete_message',
    'delete_account',
    'unmark_recipient_self',
    'admin_role_grant','admin_role_revoke',
    'admin_task_create','admin_task_update','admin_task_delete',
    'org_application_approve','org_application_reject'
  )) not valid;

alter table public.audit_events validate constraint audit_events_action_check_v6;
alter table public.audit_events
  rename constraint audit_events_action_check_v6 to audit_events_action_check;

-- ── 3. admin_org_application_list ───────────────────────────────────────────
create or replace function public.admin_org_application_list(
  p_status text default null,
  p_limit  int  default 50,
  p_offset int  default 0
)
returns table (
  application_id      uuid,
  applicant_user_id   uuid,
  applicant_name      text,
  org_name            text,
  org_description     text,
  contact_email       text,
  contact_phone       text,
  website_url         text,
  status              text,
  created_at          timestamptz,
  reviewed_at         timestamptz,
  reviewed_by         uuid,
  reviewer_name       text,
  review_note         text,
  total_count         bigint
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
begin
  perform admin_assert_role(v_actor, array['super_admin','moderator']);

  if p_status is not null and p_status not in ('pending','approved','rejected') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  select count(*) into v_total
    from public.org_applications a
   where (p_status is null or a.status = p_status);

  return query
  select
    a.application_id, a.applicant_user_id, ua.display_name as applicant_name,
    a.org_name, a.org_description, a.contact_email, a.contact_phone, a.website_url,
    a.status, a.created_at, a.reviewed_at, a.reviewed_by, ur.display_name as reviewer_name,
    a.review_note, v_total as total_count
  from public.org_applications a
  left join public.users ua on ua.user_id = a.applicant_user_id
  left join public.users ur on ur.user_id = a.reviewed_by
  where (p_status is null or a.status = p_status)
  order by a.created_at desc
  limit v_lim offset v_off;
end;
$$;

revoke execute on function public.admin_org_application_list(text, int, int) from public;
grant  execute on function public.admin_org_application_list(text, int, int) to authenticated;

-- ── 4. admin_org_application_approve / _reject — shared body ───────────────
create or replace function public.admin_org_application_decide(
  p_application_id uuid,
  p_approve        boolean,
  p_note           text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor   uuid := auth.uid();
  v_curr    record;
  v_target  text;
begin
  perform admin_assert_role(v_actor, array['super_admin','moderator']);

  select * into v_curr from public.org_applications
  where application_id = p_application_id for update;
  if v_curr.application_id is null then
    raise exception 'application_not_found' using errcode = 'P0002';
  end if;
  if v_curr.status <> 'pending' then
    raise exception 'application_already_decided' using errcode = '22023';
  end if;

  v_target := case when p_approve then 'approved' else 'rejected' end;

  update public.org_applications
     set status      = v_target,
         reviewed_at = now(),
         reviewed_by = v_actor,
         review_note = nullif(btrim(coalesce(p_note, '')), '')
   where application_id = p_application_id;

  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (
    v_actor,
    case when p_approve then 'org_application_approve' else 'org_application_reject' end,
    'org_application',
    p_application_id,
    jsonb_strip_nulls(jsonb_build_object(
      'org_name',          v_curr.org_name,
      'applicant_user_id', v_curr.applicant_user_id,
      'note',              p_note
    ))
  );
end;
$$;

revoke execute on function public.admin_org_application_decide(uuid, boolean, text) from public;
grant  execute on function public.admin_org_application_decide(uuid, boolean, text) to authenticated;

create or replace function public.admin_org_application_approve(
  p_application_id uuid,
  p_note           text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  select public.admin_org_application_decide(p_application_id, true, p_note);
$$;

revoke execute on function public.admin_org_application_approve(uuid, text) from public;
grant  execute on function public.admin_org_application_approve(uuid, text) to authenticated;

create or replace function public.admin_org_application_reject(
  p_application_id uuid,
  p_note           text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  select public.admin_org_application_decide(p_application_id, false, p_note);
$$;

revoke execute on function public.admin_org_application_reject(uuid, text) from public;
grant  execute on function public.admin_org_application_reject(uuid, text) to authenticated;
