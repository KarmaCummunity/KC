-- Moderation · sanctions (FR-MOD-010, FR-ADMIN-004, D61, D133, D135)
--
-- user_account.status says what a member's state is now; user_sanctions is the history of
-- how it got there: every suspension and ban, who issued it and why, when it ends and when
-- and by whom it was lifted. Both are written together by the two functions below, which
-- every sanctioning path uses — admin RPCs, the report threshold, the false-report ladder
-- and the expiry sweep.

create table public.user_sanctions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users (id) on delete cascade,
  kind       text not null check (kind in ('suspension', 'ban')),
  reason     text not null check (reason in (
               'false_reports', 'report_threshold', 'spam', 'harassment', 'policy_violation', 'other')),
  -- Free text of the issuing staff member; read by staff only, never copied to the audit trail.
  note       text check (char_length(note) between 1 and 500),
  -- Null for a sanction applied by an automatic rule.
  issued_by  uuid references public.users (id) on delete set null,
  issued_at  timestamptz not null default now(),
  -- End of a temporary suspension; null = until lifted.
  until      timestamptz,
  lifted_at  timestamptz,
  lifted_by  uuid references public.users (id) on delete set null
);
comment on table public.user_sanctions is 'History of suspensions and bans. Written only by server code.';

-- A member has at most one sanction in force; also the member's history lookup.
create unique index user_sanctions_active_key on public.user_sanctions (user_id) where lifted_at is null;
-- Staff view of a member's history, newest first.
create index user_sanctions_user_recent_idx on public.user_sanctions (user_id, issued_at desc);
-- Foreign keys to staff members.
create index user_sanctions_issued_by_idx on public.user_sanctions (issued_by) where issued_by is not null;
create index user_sanctions_lifted_by_idx on public.user_sanctions (lifted_by) where lifted_by is not null;

alter table public.user_sanctions enable row level security;
alter table public.user_sanctions force row level security;

create policy user_sanctions_select_staff on public.user_sanctions
  for select to authenticated
  using ((select kc_access.is_admin()));
grant select on public.user_sanctions to authenticated;

-- Puts a member under a suspension or a ban: moves the account status (its machine decides
-- whether the move is legal), ends the sanction that was in force and records the new one.
-- p_issued_by is the staff member, or null for an automatic rule.
create function kc_private.account_sanction(
  p_user_id uuid, p_status text, p_reason text, p_until timestamptz, p_note text, p_issued_by uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outer_role constant text := coalesce(current_setting('kc.fsm_role', true), '');
  v_sanction_id uuid;
begin
  -- The status trigger of the audit module records no actor for a move made as `system`.
  perform set_config('kc.fsm_role', case when p_issued_by is null then 'system' else 'admin' end, true);
  update public.user_account a set status = p_status, status_until = p_until where a.user_id = p_user_id;
  perform set_config('kc.fsm_role', v_outer_role, true);

  update public.user_sanctions s set lifted_at = now(), lifted_by = p_issued_by
   where s.user_id = p_user_id and s.lifted_at is null;
  insert into public.user_sanctions (user_id, kind, reason, note, issued_by, until)
  values (p_user_id, case p_status when 'banned' then 'ban' else 'suspension' end,
          p_reason, nullif(btrim(p_note), ''), p_issued_by, p_until)
  returning id into v_sanction_id;

  perform kc_private.audit_record(
    case p_status when 'banned' then 'ban_user' else 'suspend_user' end, 'user', p_user_id,
    jsonb_build_object('status', p_status, 'reason', p_reason, 'until', p_until, 'sanction_id', v_sanction_id),
    p_issued_by);
  return v_sanction_id;
end;
$$;
comment on function kc_private.account_sanction(uuid, text, text, timestamptz, text, uuid) is
  'Applies a suspension or ban: account status, sanction history and audit row together.';

-- Returns a suspended or banned member to active and closes the sanction in force.
-- p_cause: 'admin_restore', 'expired' or 'report_dismissed'.
create function kc_private.account_restore(p_user_id uuid, p_lifted_by uuid, p_cause text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outer_role constant text := coalesce(current_setting('kc.fsm_role', true), '');
  v_from text;
begin
  select a.status into v_from from public.user_account a where a.user_id = p_user_id for update;
  perform set_config('kc.fsm_role', case when p_lifted_by is null then 'system' else 'admin' end, true);
  update public.user_account a set status = 'active', status_until = null where a.user_id = p_user_id;
  perform set_config('kc.fsm_role', v_outer_role, true);

  update public.user_sanctions s set lifted_at = now(), lifted_by = p_lifted_by
   where s.user_id = p_user_id and s.lifted_at is null;
  perform kc_private.audit_record(
    case v_from when 'banned' then 'unban_user' else 'unsuspend_user' end, 'user', p_user_id,
    jsonb_build_object('from', v_from, 'cause', p_cause), p_lifted_by);
end;
$$;
comment on function kc_private.account_restore(uuid, uuid, text) is
  'Lifts a suspension or ban: account back to active, sanction closed, audit row written.';

-- The false-report ladder (FR-MOD-010): called once for each report staff dismiss. When
-- the reporter's dismissed, not yet counted reports inside the window reach the threshold,
-- their sanction level rises by one (at most 3) and those reports are consumed. The
-- suspension length comes from the settings; a level without a length is open-ended and is
-- lifted by a staff restore. A heavier state — an admin suspension, a ban, a pending
-- deletion — is left as it is; the level still counts (D135).
create function kc_private.apply_false_report_sanction(p_reporter_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings constant kc_private.moderation_settings := (select s from kc_private.moderation_settings s);
  v_account public.user_account;
  v_level smallint;
  v_until timestamptz;
  v_suspends boolean;
begin
  -- The account row is the per-reporter lock: two dismissals cannot both count the same reports.
  select a.* into v_account from public.user_account a where a.user_id = p_reporter_id for update;
  if not found then
    return;
  end if;
  -- Informational running total; the window count below decides (FR-MOD-010 AC1).
  update public.user_account a set false_reports_count = a.false_reports_count + 1
   where a.user_id = p_reporter_id;

  if (select count(*) from public.reports r
       where r.reporter_id = p_reporter_id and r.status = 'dismissed_no_violation'
         and r.sanction_consumed_at is null
         and r.resolved_at > now() - v_settings.false_report_window) < v_settings.false_report_threshold then
    return;
  end if;

  v_level := least(v_account.false_report_sanction_count + 1, 3);
  v_until := now() + v_settings.false_report_suspension_days[v_level] * interval '1 day';
  v_suspends := v_account.status in ('active', 'pending_verification', 'suspended_for_false_reports');

  update public.user_account a set false_report_sanction_count = v_level where a.user_id = p_reporter_id;
  update public.reports r set sanction_consumed_at = now()
   where r.reporter_id = p_reporter_id and r.status = 'dismissed_no_violation'
     and r.sanction_consumed_at is null
     and r.resolved_at > now() - v_settings.false_report_window;

  if v_suspends then
    perform kc_private.account_sanction(
      p_reporter_id, 'suspended_for_false_reports', 'false_reports', v_until, null, null);
  end if;
  perform kc_private.audit_record(
    'false_report_sanction_applied', 'user', p_reporter_id,
    jsonb_build_object('level', v_level, 'until', v_until, 'suspended', v_suspends), null);
end;
$$;
comment on function kc_private.apply_false_report_sanction(uuid) is
  'Counts a dismissed report against its reporter and applies the next sanction level when due.';

-- Daily sweep: lifts every suspension whose end has passed, so a member who never signs in
-- again is not left suspended. Returns the number of accounts restored.
create function kc_private.lift_expired_suspensions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_lifted integer := 0;
begin
  for v_user_id in
    select a.user_id
      from public.user_account a
     where a.status_until <= now()
       and a.status in ('suspended_for_false_reports', 'suspended_admin')
       for update skip locked
  loop
    perform kc_private.account_restore(v_user_id, null, 'expired');
    v_lifted := v_lifted + 1;
  end loop;
  return v_lifted;
end;
$$;
comment on function kc_private.lift_expired_suspensions() is
  'Scheduled job: restores accounts whose temporary suspension has ended.';
