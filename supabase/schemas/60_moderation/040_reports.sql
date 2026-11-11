-- Moderation · reports and the reporter's own hide (FR-MOD-001, FR-MOD-007, FR-MOD-011)
--
-- A member reports a post, a member, a comment or a chat. The report is a plain insert
-- under RLS; triggers do the rest. Its status moves open → confirmed_violation |
-- dismissed_no_violation, by staff only. The reporter stops seeing the target at once,
-- whatever staff later decide.

-- Every number the moderation rules use, in one row, so a product decision is a data change
-- and no function carries a literal (D33, D61, D134, FR-MOD-010).
create table kc_private.moderation_settings (
  singleton                      boolean primary key default true check (singleton),
  -- Distinct reporters with an open report, inside the window, that hide a post or a chat.
  content_hide_reporters         smallint not null default 3 check (content_hide_reporters > 0),
  content_hide_window            interval not null default interval '14 days',
  -- Distinct reporters that suspend a member; the same numbers lift the suspension (D134).
  user_suspend_reporters         smallint not null default 5 check (user_suspend_reporters > 0),
  user_suspend_window            interval not null default interval '30 days',
  -- Dismissed reports of one reporter, inside the window, that trigger a sanction.
  false_report_threshold         smallint not null default 5 check (false_report_threshold > 0),
  false_report_window            interval not null default interval '30 days',
  -- Length of the suspension at each sanction level; a level beyond the list is open-ended.
  false_report_suspension_days   integer[] not null default '{7,30}'
);
comment on table kc_private.moderation_settings is 'Thresholds and windows of the moderation rules. One row.';
alter table kc_private.moderation_settings enable row level security;
alter table kc_private.moderation_settings force row level security;
-- The one row, holding the approved defaults above.
insert into kc_private.moderation_settings default values;

insert into kc_private.fsm_state (machine_id, status) values
  ('report', 'open'),
  ('report', 'confirmed_violation'),
  ('report', 'dismissed_no_violation');
insert into kc_private.fsm_edge (machine_id, from_status, to_status, role) values
  ('report', 'open', 'confirmed_violation', 'admin'),
  ('report', 'open', 'dismissed_no_violation', 'admin');

create table public.reports (
  id                   uuid primary key default gen_random_uuid(),
  -- Null once the reporter's account is purged (design §4.1): the report stays.
  reporter_id          uuid references public.users (id) on delete set null,
  target_type          text not null check (target_type in ('post', 'user', 'comment', 'chat')),
  -- Id of the post, member, comment or chat. No foreign key: one column, four tables, and
  -- a report outlives a purged target.
  target_id            uuid not null,
  reason               text not null check (reason in ('Spam', 'Offensive', 'Misleading', 'Illegal', 'Other')),
  note                 text check (char_length(note) between 1 and 500),
  -- Lifecycle, machine `report`. Never written by a device.
  status               text not null default 'open',
  resolved_at          timestamptz,
  resolved_by          uuid references public.users (id) on delete set null,
  -- Set when a dismissed report has been counted into a false-report sanction (FR-MOD-010 AC1).
  sanction_consumed_at timestamptz,
  created_at           timestamptz not null default now(),
  constraint reports_resolution_chk check ((status = 'open') = (resolved_at is null))
);
comment on table public.reports is 'Reports by members about posts, members, comments and chats.';

-- One open report per reporter and target (FR-MOD-001 AC7); also "my reports".
create unique index reports_open_per_reporter_key on public.reports (reporter_id, target_type, target_id)
  where status = 'open';
-- Threshold count and the case screen: reports of one target, newest first.
create index reports_target_idx on public.reports (target_type, target_id, created_at desc);
-- Staff inbox: open reports, oldest first.
create index reports_open_inbox_idx on public.reports (created_at, id) where status = 'open';
-- False-report window of a reporter: their dismissed, not yet counted reports.
create index reports_reporter_dismissed_idx on public.reports (reporter_id, resolved_at)
  where status = 'dismissed_no_violation' and sanction_consumed_at is null;
-- Foreign key to the staff member who resolved.
create index reports_resolved_by_idx on public.reports (resolved_by) where resolved_by is not null;

create trigger reports_status_fsm
  before insert or update of status on public.reports
  for each row execute function kc_private.fsm_guard_status('report', 'status');

alter table public.reports enable row level security;
alter table public.reports force row level security;

create policy reports_select_own on public.reports
  for select to authenticated
  using (reporter_id = (select auth.uid()));
create policy reports_select_staff on public.reports
  for select to authenticated
  using ((select kc_access.is_admin()));
-- A member with an active account files a report as themselves; it always starts open.
create policy reports_insert_own on public.reports
  for insert to authenticated
  with check (
    reporter_id = (select auth.uid())
    and status = 'open'
    and exists (select 1 from public.users u where u.id = (select auth.uid()) and u.is_active));

grant select on public.reports to authenticated;
grant insert (id, reporter_id, target_type, target_id, reason, note) on public.reports to authenticated;

-- ── The reporter's hide (FR-MOD-001 AC5, FR-MOD-011) ────────────────────────
create table public.report_hides (
  reporter_id uuid not null references public.users (id) on delete cascade,
  target_type text not null check (target_type in ('post', 'user', 'comment', 'chat')),
  target_id   uuid not null,
  created_at  timestamptz not null default now(),
  primary key (reporter_id, target_type, target_id)
);
comment on table public.report_hides is 'Targets a member reported and therefore no longer sees. Permanent until they remove it.';

alter table public.report_hides enable row level security;
alter table public.report_hides force row level security;

-- Written by the report trigger; the reporter may read and lift their own hides (AC2).
create policy report_hides_select_own on public.report_hides
  for select to authenticated
  using (reporter_id = (select auth.uid()));
create policy report_hides_delete_own on public.report_hides
  for delete to authenticated
  using (reporter_id = (select auth.uid()));
grant select, delete on public.report_hides to authenticated;

-- A reported post, member or comment disappears for its reporter on every surface: the
-- policies are restrictive, so they narrow whatever any other policy allows, and each is one
-- primary-key probe that runs under the caller's own access to report_hides (their rows
-- only). Staff are exempt: a moderator who reported a post must still be able to review it.
-- Chats get the same policy from the messaging module.
create policy posts_hide_reported on public.posts
  as restrictive
  for select to authenticated
  using (
    not exists (select 1 from public.report_hides h
                 where h.reporter_id = (select auth.uid())
                   and h.target_type = 'post' and h.target_id = posts.id)
    or (select kc_access.is_admin()));
create policy users_hide_reported on public.users
  as restrictive
  for select to authenticated
  using (
    not exists (select 1 from public.report_hides h
                 where h.reporter_id = (select auth.uid())
                   and h.target_type = 'user' and h.target_id = users.id)
    or (select kc_access.is_admin()));
create policy post_comments_hide_reported on public.post_comments
  as restrictive
  for select to authenticated
  using (
    not exists (select 1 from public.report_hides h
                 where h.reporter_id = (select auth.uid())
                   and h.target_type = 'comment' and h.target_id = post_comments.id)
    or (select kc_access.is_admin()));

-- Checks a new report: the target must exist where this database can tell (a chat is
-- checked by the messaging module), must not be the reporter's own, and a post already
-- removed by staff is not reported again. Errors (P0001): report_target_not_found,
-- cannot_report_self, target_already_moderated.
create function kc_private.reports_validate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid;
  v_status text;
begin
  perform kc_private.rate_limit_enforce('report_create', new.reporter_id);  -- 95_platform
  if new.target_type = 'post' then
    select p.owner_id, p.status into v_owner_id, v_status from public.posts p where p.id = new.target_id;
  elsif new.target_type = 'user' then
    select u.id into v_owner_id from public.users u where u.id = new.target_id;
  elsif new.target_type = 'comment' then
    select c.author_id, c.status into v_owner_id, v_status
      from public.post_comments c where c.id = new.target_id;
  else
    return new;
  end if;

  if v_owner_id is null then
    raise exception 'report_target_not_found' using errcode = 'P0001';
  end if;
  if v_owner_id = new.reporter_id then
    raise exception 'cannot_report_self' using errcode = 'P0001';
  end if;
  if v_status in ('removed_admin', 'deleted', 'draft') then
    raise exception 'target_already_moderated' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger reports_validate
  before insert on public.reports
  for each row execute function kc_private.reports_validate();
