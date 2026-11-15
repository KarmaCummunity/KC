-- 0005_init_moderation | P0.2.e — Moderation schema (reports, queue, reporter-side hides, audit log)
-- FR-MOD-001+002+005+008+010+011+012, FR-CHAT-009+010, INV-C3
--
-- Closes the P0.2.d note about kind='system' messages: this migration adds
-- the SECURITY DEFINER `inject_system_message()` RPC that the moderation
-- triggers call to drop a system message into the super admin's support
-- thread (FR-MOD-001 AC4) — same RPC FR-MOD-002 will call from the app layer.

-- ── 0. users — schema additions for sanctions ────────────────────────────────
-- false_reports_count is incremented by the report-status-change trigger.
-- account_status_until carries the suspension end time (FR-MOD-010 AC2/AC4);
-- the actual escalation logic (7d → 30d → permanent) is intentionally NOT in
-- this migration — it requires sliding-window counts and admin-driven review,
-- which belong in the application layer once admin tooling lands. The columns
-- are reserved here so the RLS / state machine has stable hooks.
alter table public.users
  add column if not exists false_reports_count          integer not null default 0
    check (false_reports_count >= 0),
  add column if not exists false_report_sanction_count  integer not null default 0
    check (false_report_sanction_count between 0 and 3),
  add column if not exists account_status_until         timestamptz;

-- ── 0.b chats — soft-removal flag for moderation ─────────────────────────────
-- FR-MOD-005 AC2 chat dimension: "the chat is hidden from both users with a
-- moderation banner." We add `removed_at` rather than deleting rows so the
-- conversation history is preserved for audit/restore (FR-ADMIN-002).
alter table public.chats
  add column if not exists removed_at timestamptz;

-- Refresh `is_chat_visible_to` to include the moderation hide. Same signature
-- as P0.2.d, so all RLS policies pick the new behaviour up automatically.
create or replace function public.is_chat_visible_to(p_chat public.chats, p_viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_viewer is null then false
    when p_viewer not in (p_chat.participant_a, p_chat.participant_b) then false
    when p_chat.removed_at is not null then false
    when public.has_blocked(
      p_viewer,
      case
        when p_viewer = p_chat.participant_a then p_chat.participant_b
        else p_chat.participant_a
      end
    ) then false
    else true
  end;
$$;

-- ── 1. is_admin() — wraps users.is_super_admin ───────────────────────────────
-- SECURITY DEFINER: regular users RLS hides admin status of others. Without
-- DEFINER, a policy that asks "is the current user an admin?" would only
-- succeed when they read their own row, which is fine — but using a single
-- helper centralises the predicate and lets us swap in role-based admin
-- detection (e.g. JWT `app_metadata.role`) later without touching every RLS.
create or replace function public.is_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when uid is null then false
    else exists (
      select 1 from public.users where user_id = uid and is_super_admin = true
    )
  end;
$$;

-- ── 2. reports ──────────────────────────────────────────────────────────────
-- target_type='none' is the issue-report path (FR-MOD-002): target_id is null
-- and auto-removal does not apply. For all other target_types, target_id is
-- required and references the corresponding row (validated by trigger; we
-- don't FK because the target table varies).
create table if not exists public.reports (
  report_id     uuid primary key default gen_random_uuid(),
  reporter_id   uuid not null references public.users(user_id) on delete cascade,
  target_type   text not null
    check (target_type in ('post','user','chat','none')),
  target_id     uuid,
  reason        text not null
    check (reason in ('Spam','Offensive','Misleading','Illegal','Other')),
  note          text
    check (note is null or char_length(note) <= 500),
  status        text not null default 'open'
    check (status in ('open','confirmed_violation','dismissed_no_violation')),
  resolved_at   timestamptz,
  resolved_by   uuid references public.users(user_id) on delete set null,
  created_at    timestamptz not null default now(),
  -- target_id required iff target_type <> 'none'
  constraint reports_target_shape check (
    (target_type = 'none' and target_id is null)
    or (target_type <> 'none' and target_id is not null)
  ),
  -- resolved_at + resolved_by populated together iff status terminal
  constraint reports_resolution_shape check (
    (status = 'open' and resolved_at is null and resolved_by is null)
    or (status <> 'open' and resolved_at is not null)
  )
);

-- 24-hour dedup (FR-MOD-001 AC7): same reporter cannot file the same target
-- twice within 24h. Implemented as a partial unique index on (reporter, target,
-- created_at-bucket-day) — but PostgreSQL can't index an arbitrary expression
-- robustly without IMMUTABLE wrappers. Trigger-based check is simpler and
-- matches the SRS prose exactly.
create index reports_target_open_idx
  on public.reports (target_type, target_id, status)
  where status = 'open' and target_id is not null;

create index reports_target_distinct_reporters_idx
  on public.reports (target_type, target_id, reporter_id)
  where status = 'open' and target_id is not null;

create index reports_reporter_recent_idx
  on public.reports (reporter_id, created_at desc);

create index reports_admin_inbox_idx
  on public.reports (status, created_at desc)
  where status = 'open';

-- ── 3. moderation_queue_entries ─────────────────────────────────────────────
-- Suspect-flag pipeline (FR-MOD-008). Idempotent on (target_type, target_id,
-- reason) — re-firing the same trigger doesn't pile up rows.
create table if not exists public.moderation_queue_entries (
  entry_id      uuid primary key default gen_random_uuid(),
  target_type   text not null check (target_type in ('post','user','chat')),
  target_id     uuid not null,
  reason        text not null
    check (reason in ('excessive_reopens','forbidden_keyword','manual_flag')),
  metadata      jsonb,
  resolved_at   timestamptz,
  resolved_by   uuid references public.users(user_id) on delete set null,
  created_at    timestamptz not null default now()
);

-- Only one *open* (resolved_at IS NULL) entry per (target, reason).
create unique index moderation_queue_open_uniq_idx
  on public.moderation_queue_entries (target_type, target_id, reason)
  where resolved_at is null;

create index moderation_queue_admin_inbox_idx
  on public.moderation_queue_entries (created_at desc)
  where resolved_at is null;

-- ── 4. reporter_hides ───────────────────────────────────────────────────────
-- FR-MOD-001 AC5 / FR-MOD-011: post or profile is removed from the reporter's
-- view as soon as they file a report, regardless of moderator outcome.
create table if not exists public.reporter_hides (
  reporter_id   uuid not null references public.users(user_id) on delete cascade,
  target_type   text not null check (target_type in ('post','user','chat')),
  target_id     uuid not null,
  created_at    timestamptz not null default now(),
  primary key (reporter_id, target_type, target_id)
);

create index reporter_hides_target_idx
  on public.reporter_hides (target_type, target_id);

-- ── 5. audit_events ─────────────────────────────────────────────────────────
-- Append-only log of moderation-relevant operations (FR-MOD-012). No UPDATE
-- or DELETE policies; the table is INSERT-only at the application layer.
-- Retention is handled operationally (FR-MOD-012 AC3 — 24 months), not by RLS.
create table if not exists public.audit_events (
  event_id     uuid primary key default gen_random_uuid(),
  actor_id     uuid references public.users(user_id) on delete set null,
  action       text not null
    check (action in (
      'block_user','unblock_user',
      'report_target',
      'auto_remove_target','manual_remove_target','restore_target',
      'suspend_user','unsuspend_user',
      'false_report_sanction_applied',
      'dismiss_report','confirm_report'
    )),
  target_type  text check (target_type in ('post','user','chat','report','none')),
  target_id    uuid,
  metadata     jsonb,
  created_at   timestamptz not null default now()
);

create index audit_events_actor_recent_idx
  on public.audit_events (actor_id, created_at desc) where actor_id is not null;
create index audit_events_target_recent_idx
  on public.audit_events (target_type, target_id, created_at desc)
  where target_id is not null;
create index audit_events_action_recent_idx
  on public.audit_events (action, created_at desc);

-- ── 6. is_post_visible_to() — refresh to filter reporter_hides ───────────────
-- Same signature as P0.2.b/c. Preserves the owner-always-sees rule, the block
-- short-circuit, and the FollowersOnly branch; adds a final reporter_hide
-- check before returning true. Hidden targets are filtered away from feeds
-- and search even if visibility otherwise allows them (FR-MOD-001 AC5).
create or replace function public.is_post_visible_to(p_post public.posts, p_viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    -- Owner always sees their own row, regardless of any moderation state.
    when p_post.owner_id = p_viewer then true
    -- Block short-circuit: bilateral.
    when public.is_blocked(p_viewer, p_post.owner_id) then false
    -- Reporter-side hides apply BEFORE every other branch (FR-MOD-001 AC5).
    when exists (
      select 1 from public.reporter_hides h
      where h.reporter_id = p_viewer
        and h.target_type = 'post'
        and h.target_id   = p_post.post_id
    ) then false
    -- The owner has been admin-suspended → their open posts are not surfaced
    -- to anyone but themselves (handled by the owner-equals-viewer branch
    -- above; explicit check here for closed_delivered + recipients).
    -- (intentional fallthrough — visibility for tomb states is owner-only.)
    when p_post.status in ('removed_admin','deleted_no_recipient','expired') then false
    when p_post.status = 'closed_delivered' then exists (
      select 1 from public.recipients r
      where r.post_id = p_post.post_id and r.recipient_user_id = p_viewer
    )
    when p_post.status = 'open' and p_post.visibility = 'Public' then true
    when p_post.status = 'open' and p_post.visibility = 'OnlyMe' then false
    when p_post.status = 'open' and p_post.visibility = 'FollowersOnly' then
      public.is_following(p_viewer, p_post.owner_id)
    else false
  end;
$$;

-- ── 7. inject_system_message() — used by mod triggers + FR-MOD-002 app layer ─
-- Inserts a kind='system' row into a chat. Bypasses the messages INSERT RLS
-- (which restricts kind to 'user' for clients) by running as DEFINER.
-- Returns the new message_id.
create or replace function public.inject_system_message(
  p_chat_id  uuid,
  p_payload  jsonb,
  p_body     text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid := gen_random_uuid();
begin
  if p_chat_id is null then
    raise exception 'chat_id_required' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.chats where chat_id = p_chat_id) then
    raise exception 'chat_not_found' using errcode = 'check_violation';
  end if;
  insert into public.messages (
    message_id, chat_id, sender_id, kind, body, system_payload, status
  ) values (
    new_id, p_chat_id, null, 'system', p_body, coalesce(p_payload, '{}'::jsonb), 'delivered'
  );
  return new_id;
end;
$$;

-- ── 8. find_or_create_support_chat() — internal helper for mod alerts ───────
-- Finds (or creates) the support thread between `p_user` and the super admin.
-- Used by the report INSERT trigger to deliver FR-MOD-001 AC4 system messages.
create or replace function public.find_or_create_support_chat(p_user uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid;
  v_chat  uuid;
  v_a     uuid;
  v_b     uuid;
begin
  select user_id into v_admin from public.users where is_super_admin = true limit 1;
  if v_admin is null then
    return null;  -- no admin configured; skip system-message side-effect
  end if;
  if v_admin = p_user then
    return null;  -- the admin reporting themselves is a no-op for this helper
  end if;
  -- Canonical pair ordering (matches chats CHECK).
  if p_user < v_admin then v_a := p_user; v_b := v_admin;
                      else v_a := v_admin; v_b := p_user; end if;
  select chat_id into v_chat
  from public.chats where participant_a = v_a and participant_b = v_b;
  if v_chat is null then
    insert into public.chats (participant_a, participant_b, is_support_thread)
    values (v_a, v_b, true)
    returning chat_id into v_chat;
  end if;
  return v_chat;
end;
$$;

-- ── 9. reports — validation BEFORE INSERT ───────────────────────────────────
-- FR-MOD-001 AC7: "Duplicate reports from the same reporter on the same target
-- within 24 hours are rejected with DUPLICATE_REPORT (idempotency)."
-- Also validates that the target row exists and is reachable to the reporter.
create or replace function public.reports_validate_before_insert()
returns trigger
language plpgsql
as $$
begin
  if new.reporter_id is null or new.reporter_id <> auth.uid() then
    -- Belt-and-braces; the RLS policy below is the primary enforcer.
    raise exception 'reporter_must_be_self' using errcode = 'check_violation';
  end if;

  -- Target sanity per type. The exists checks ride the calling user's RLS,
  -- which means: a reporter cannot file against a target they cannot see.
  -- This is intentional (no flooding reports against private rows).
  if new.target_type = 'post' then
    if not exists (select 1 from public.posts where post_id = new.target_id) then
      raise exception 'report_target_not_visible'
        using errcode = 'check_violation', detail = 'target_type=post';
    end if;
    if (select owner_id from public.posts where post_id = new.target_id) = new.reporter_id then
      raise exception 'cannot_report_self' using errcode = 'check_violation';
    end if;
  elsif new.target_type = 'user' then
    if not exists (select 1 from public.users where user_id = new.target_id) then
      raise exception 'report_target_not_visible'
        using errcode = 'check_violation', detail = 'target_type=user';
    end if;
    if new.target_id = new.reporter_id then
      raise exception 'cannot_report_self' using errcode = 'check_violation';
    end if;
  elsif new.target_type = 'chat' then
    if not exists (
      select 1 from public.chats c
      where c.chat_id = new.target_id
        and new.reporter_id in (c.participant_a, c.participant_b)
    ) then
      raise exception 'report_target_not_visible'
        using errcode = 'check_violation', detail = 'target_type=chat';
    end if;
  end if;
  -- target_type='none' has no target — nothing else to validate.

  -- 24h dedup (skipped for target_type='none', where dedup is meaningless).
  if new.target_type <> 'none' and exists (
    select 1 from public.reports
    where reporter_id = new.reporter_id
      and target_type = new.target_type
      and target_id   = new.target_id
      and created_at  > now() - interval '24 hours'
  ) then
    raise exception 'duplicate_report'
      using errcode = 'unique_violation', detail = 'window=24h';
  end if;

  return new;
end;
$$;

create trigger reports_before_insert
  before insert on public.reports
  for each row execute function public.reports_validate_before_insert();

-- ── 10. reports — auto-hide + audit + threshold AFTER INSERT ────────────────
-- Three things happen on every successful report INSERT (transactionally):
--   (1) reporter_hides row created (FR-MOD-001 AC5 — idempotent).
--   (2) audit_events row written (FR-MOD-012 AC1 'report_target').
--   (3) auto-removal threshold check (FR-MOD-005): if 3+ DISTINCT reporters
--       have an *open* report on the same target, transition the target.
--   (4) system message dropped into the super admin support thread of the
--       reporter (FR-MOD-001 AC4) — best-effort, never blocks the report.
create or replace function public.reports_after_insert_apply_effects()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  distinct_reporters int;
  v_chat uuid;
begin
  -- (1) Reporter-side hide (no-op for target_type='none').
  if new.target_type <> 'none' then
    insert into public.reporter_hides (reporter_id, target_type, target_id)
    values (new.reporter_id, new.target_type, new.target_id)
    on conflict do nothing;
  end if;

  -- (2) Audit.
  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (
    new.reporter_id,
    'report_target',
    new.target_type,
    new.target_id,
    jsonb_build_object('report_id', new.report_id, 'reason', new.reason)
  );

  -- (3) Auto-removal threshold (skipped for target_type='none').
  if new.target_type <> 'none' then
    select count(distinct reporter_id) into distinct_reporters
    from public.reports
    where target_type = new.target_type
      and target_id   = new.target_id
      and status      = 'open';

    if distinct_reporters >= 3 then
      if new.target_type = 'post' then
        update public.posts set status = 'removed_admin'
        where post_id = new.target_id and status <> 'removed_admin';
      elsif new.target_type = 'user' then
        update public.users set account_status = 'suspended_admin'
        where user_id = new.target_id and account_status not in ('suspended_admin','banned','deleted');
      elsif new.target_type = 'chat' then
        update public.chats set removed_at = now()
        where chat_id = new.target_id and removed_at is null;
      end if;

      insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
      values (
        null,
        'auto_remove_target',
        new.target_type,
        new.target_id,
        jsonb_build_object('distinct_reporters', distinct_reporters)
      );
    end if;
  end if;

  -- (4) Best-effort support-thread system message. Never raises.
  begin
    v_chat := public.find_or_create_support_chat(new.reporter_id);
    if v_chat is not null then
      perform public.inject_system_message(
        v_chat,
        jsonb_build_object(
          'kind', 'report_received',
          'report_id', new.report_id,
          'target_type', new.target_type,
          'target_id', new.target_id,
          'reason', new.reason
        ),
        null
      );
    end if;
  exception when others then
    -- Swallow — report INSERT must succeed even if support-thread side-effect fails.
    null;
  end;

  return new;
end;
$$;

create trigger reports_after_insert_effects
  after insert on public.reports
  for each row execute function public.reports_after_insert_apply_effects();

-- ── 11. reports — status transition validation + counters ────────────────────
-- Allowed transitions: open → confirmed_violation, open → dismissed_no_violation.
-- Any other transition errors. The ADMIN role drives this — RLS below restricts.
-- On dismissed_no_violation, increment users.false_reports_count for the
-- reporter (FR-MOD-010 AC1). Sanction escalation (7d/30d/permanent) is NOT
-- applied here; the column is reserved for the admin-tooling slice.
create or replace function public.reports_on_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = new.status then
    return new;
  end if;
  if old.status <> 'open' then
    raise exception 'invalid_report_status_transition'
      using errcode = 'check_violation',
            detail  = 'from=' || old.status || ' to=' || new.status;
  end if;
  if new.status not in ('confirmed_violation','dismissed_no_violation') then
    raise exception 'invalid_report_status_target'
      using errcode = 'check_violation', detail = 'status=' || new.status;
  end if;

  new.resolved_at := now();
  if new.resolved_by is null then
    new.resolved_by := auth.uid();
  end if;

  return new;
end;
$$;

create trigger reports_before_update_status
  before update of status on public.reports
  for each row execute function public.reports_on_status_change();

create or replace function public.reports_after_status_change_apply_effects()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = new.status then
    return new;
  end if;

  if new.status = 'dismissed_no_violation' then
    update public.users
    set false_reports_count = false_reports_count + 1
    where user_id = new.reporter_id;
  end if;

  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (
    auth.uid(),
    case when new.status = 'confirmed_violation' then 'confirm_report'
         else 'dismiss_report' end,
    'report',
    new.report_id,
    jsonb_build_object(
      'reporter_id', new.reporter_id,
      'target_type', new.target_type,
      'target_id',   new.target_id,
      'reason',      new.reason
    )
  );

  return new;
end;
$$;

create trigger reports_after_status_change_effects
  after update of status on public.reports
  for each row execute function public.reports_after_status_change_apply_effects();

-- ── 12. posts — INV-C3 trigger on reopen_count ───────────────────────────────
-- "Post.reopen_count >= 5 ⇒ a ModerationQueueEntry with reason='excessive_reopens'
-- exists for that post." Unique partial index on (target, reason) WHERE
-- resolved_at IS NULL makes the insert idempotent — repeated bumps don't pile up.
create or replace function public.posts_after_reopen_check_queue()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.reopen_count >= 5 and (old.reopen_count is null or old.reopen_count < 5) then
    insert into public.moderation_queue_entries (target_type, target_id, reason, metadata)
    values (
      'post',
      new.post_id,
      'excessive_reopens',
      jsonb_build_object('reopen_count', new.reopen_count)
    )
    on conflict (target_type, target_id, reason) where resolved_at is null
      do nothing;
  end if;
  return new;
end;
$$;

create trigger posts_after_update_reopen_count
  after update of reopen_count on public.posts
  for each row execute function public.posts_after_reopen_check_queue();

-- ── 13. blocks — audit on insert / delete (FR-MOD-012) ───────────────────────
-- Adds audit-trail rows retroactively for the P0.2.c block flow. This is the
-- right migration for these triggers because audit_events is created here.
create or replace function public.blocks_audit_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (
    new.blocker_id,
    'block_user',
    'user',
    new.blocked_id,
    null
  );
  return new;
end;
$$;

create trigger blocks_after_insert_audit
  after insert on public.blocks
  for each row execute function public.blocks_audit_on_insert();

create or replace function public.blocks_audit_on_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (
    old.blocker_id,
    'unblock_user',
    'user',
    old.blocked_id,
    null
  );
  return old;
end;
$$;

create trigger blocks_after_delete_audit
  after delete on public.blocks
  for each row execute function public.blocks_audit_on_delete();

-- ── 14. RLS — reports ───────────────────────────────────────────────────────
alter table public.reports enable row level security;

-- SELECT: reporter sees their own reports; admin sees everything.
create policy reports_select_self_or_admin on public.reports
  for select
  using (
    auth.uid() = reporter_id
    or public.is_admin(auth.uid())
  );

-- INSERT: only as myself, only with status='open' (terminal states are
-- admin-driven). Trigger does the dedup + target validation.
create policy reports_insert_self on public.reports
  for insert
  with check (
    auth.uid() = reporter_id
    and status = 'open'
  );

-- UPDATE: admin only. Status transitions are validated by the BEFORE UPDATE
-- trigger; column-level grants below restrict mutable columns.
create policy reports_update_admin on public.reports
  for update
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- ── 15. RLS — moderation_queue_entries ──────────────────────────────────────
alter table public.moderation_queue_entries enable row level security;

create policy moderation_queue_select_admin on public.moderation_queue_entries
  for select using (public.is_admin(auth.uid()));

-- No client INSERT policy — all entries arrive via SECURITY DEFINER triggers.
-- UPDATE (resolve): admin only.
create policy moderation_queue_update_admin on public.moderation_queue_entries
  for update
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- ── 16. RLS — reporter_hides ────────────────────────────────────────────────
alter table public.reporter_hides enable row level security;

create policy reporter_hides_select_self on public.reporter_hides
  for select using (auth.uid() = reporter_id);

-- INSERT direct from clients is allowed (e.g. "hide this without reporting"
-- could be a future feature). For MVP the only writer is the report trigger;
-- the policy is permissive enough to allow either path.
create policy reporter_hides_insert_self on public.reporter_hides
  for insert with check (auth.uid() = reporter_id);

create policy reporter_hides_delete_self on public.reporter_hides
  for delete using (auth.uid() = reporter_id);

-- ── 17. RLS — audit_events (admin-only SELECT, no client writes) ─────────────
alter table public.audit_events enable row level security;

create policy audit_events_select_admin on public.audit_events
  for select using (public.is_admin(auth.uid()));

-- No INSERT / UPDATE / DELETE policies — all writes flow through SECURITY
-- DEFINER triggers. RLS rejection on direct client INSERT is the desired
-- outcome here (audit log integrity).

-- ── 18. Grants ──────────────────────────────────────────────────────────────
grant select          on public.reports                  to authenticated;
grant insert          on public.reports                  to authenticated;
grant update (status, resolved_at, resolved_by)
                      on public.reports                  to authenticated;

grant select, update  on public.moderation_queue_entries to authenticated;

grant select          on public.reporter_hides           to authenticated;
grant insert, delete  on public.reporter_hides           to authenticated;

grant select          on public.audit_events             to authenticated;

-- RPC grants (must be explicit for SECURITY DEFINER functions called via PostgREST).
grant execute on function public.is_admin(uuid)                          to anon, authenticated;
grant execute on function public.inject_system_message(uuid, jsonb, text) to authenticated;
-- find_or_create_support_chat is internal — no client grant.
