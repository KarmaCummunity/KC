-- Identity · user_account (server-written account state)
--
-- Account status, onboarding progress, sanctions and the 30-day deletion grace period.
-- The member may read their own row; nothing here is writable from a device.

insert into kc_private.fsm_state (machine_id, status) values
  ('account_status', 'pending_verification'),
  ('account_status', 'active'),
  ('account_status', 'suspended_for_false_reports'),
  ('account_status', 'suspended_admin'),
  ('account_status', 'banned'),
  ('account_status', 'pending_deletion'),
  ('onboarding', 'pending_basic_info'),
  ('onboarding', 'pending_avatar'),
  ('onboarding', 'completed');

insert into kc_private.fsm_edge (machine_id, from_status, to_status) values
  ('account_status', 'pending_verification', 'active'),
  ('account_status', 'pending_verification', 'suspended_for_false_reports'),
  ('account_status', 'pending_verification', 'suspended_admin'),
  ('account_status', 'pending_verification', 'banned'),
  ('account_status', 'pending_verification', 'pending_deletion'),
  ('account_status', 'active', 'suspended_for_false_reports'),
  ('account_status', 'active', 'suspended_admin'),
  ('account_status', 'active', 'banned'),
  ('account_status', 'active', 'pending_deletion'),
  ('account_status', 'suspended_for_false_reports', 'active'),
  ('account_status', 'suspended_for_false_reports', 'suspended_admin'),
  ('account_status', 'suspended_for_false_reports', 'banned'),
  ('account_status', 'suspended_admin', 'active'),
  ('account_status', 'suspended_admin', 'banned'),
  ('account_status', 'banned', 'active'),
  -- Restoring within the grace period returns to the status held before the request.
  ('account_status', 'pending_deletion', 'active'),
  ('account_status', 'pending_deletion', 'pending_verification'),
  ('onboarding', 'pending_basic_info', 'pending_avatar'),
  -- Deferred basic details (FR-AUTH-015): the member skipped the avatar step.
  ('onboarding', 'pending_basic_info', 'completed'),
  ('onboarding', 'pending_avatar', 'completed');

create table public.user_account (
  user_id                     uuid primary key references public.users (id) on delete cascade,
  status                      text not null default 'pending_verification',
  -- End of a temporary suspension; null for every other status.
  status_until                timestamptz,
  onboarding_state            text not null default 'pending_basic_info',
  -- Moderation counters behind the false-report sanction ladder.
  false_reports_count         integer not null default 0 check (false_reports_count >= 0),
  false_report_sanction_count smallint not null default 0 check (false_report_sanction_count between 0 and 3),
  -- A member barred from the food world cannot post there until this time.
  food_posting_banned_until   timestamptz,
  verified_at                 timestamptz,
  verification_method         text check (verification_method in ('manual', 'document', 'provider', 'org_vouch')),
  -- Account deletion: requested → hidden at once → purged after the grace period.
  deletion_requested_at       timestamptz,
  deletion_purge_at           timestamptz,
  status_before_deletion      text check (status_before_deletion in ('active', 'pending_verification')),
  updated_at                  timestamptz not null default now(),
  -- A purge date exists exactly while the account is pending deletion.
  constraint user_account_pending_deletion_chk
    check ((status = 'pending_deletion') = (deletion_purge_at is not null)),
  constraint user_account_deletion_fields_chk
    check ((deletion_purge_at is null) = (deletion_requested_at is null)
       and (deletion_purge_at is null) = (status_before_deletion is null))
);
comment on table public.user_account is 'Account status, onboarding and deletion state. Written only by server code.';

-- Daily purge job: accounts whose grace period has ended.
create index user_account_purge_due_idx on public.user_account (deletion_purge_at)
  where deletion_purge_at is not null;
-- Daily job that lifts expired suspensions.
create index user_account_status_until_idx on public.user_account (status_until)
  where status_until is not null;

create trigger user_account_status_fsm
  before insert or update of status on public.user_account
  for each row execute function kc_private.fsm_guard_status('account_status', 'status');

create trigger user_account_onboarding_fsm
  before insert or update of onboarding_state on public.user_account
  for each row execute function kc_private.fsm_guard_status('onboarding', 'onboarding_state');

create trigger user_account_set_updated_at
  before update on public.user_account
  for each row execute function kc_private.set_updated_at();

-- Keeps users.is_active equal to (status = 'active'), so profile visibility follows the
-- account state in the same transaction that changes it.
create function kc_private.user_account_sync_is_active()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.users u
     set is_active = (new.status = 'active')
   where u.id = new.user_id
     and u.is_active is distinct from (new.status = 'active');
  return null;
end;
$$;

create trigger user_account_sync_is_active
  after insert or update of status on public.user_account
  for each row execute function kc_private.user_account_sync_is_active();

alter table public.user_account enable row level security;
alter table public.user_account force row level security;

create policy user_account_select_self on public.user_account
  for select to authenticated
  using (user_id = (select auth.uid()));

grant select on public.user_account to authenticated;
