-- 0696_fsm_account_status | Wave 3a of the FSM kernel program (#1989, G61)
--
-- `users.account_status` moves onto the kernel (0680), with the PM decisions of 2026-11-09
-- (docs/spec/90_decisions_log.md):
--   * only a super admin lifts a ban (`admin_restore_target`, FR-ADMIN ban AC3);
--   * a report suspension lifts when the D61 rule that imposed it no longer holds
--     (`kc_private.report_threshold_reached`, one rule for imposing and lifting);
--   * a false-report sanction never replaces a heavier state (admin suspension, ban,
--     pending deletion); its open-ended third level is lifted by an admin restore.
--
-- 1. Catalog rows for machine `account_status`, equal to `accountStatusMachine` in @kc/domain.
-- 2. `kc_private.report_threshold_reached`: the D61 rule (5 distinct reporters in 30 days on a
--    user, 3 in 14 days on a post or chat), shared by the dismissal below.
-- 3. `users_account_status_fsm` (before update of account_status): every status write follows
--    the graph; a same-status write is a no-op. `deleted` is not a state: the purge removes
--    the row.
-- 4. Writers brought onto the graph:
--    - `admin_ban_user` refuses an account under deletion (`account_pending_deletion`);
--    - `reports_after_status_change_apply_sanctions` raises the sanction level but leaves a
--      heavier status alone;
--    - `admin_dismiss_report` lifts a target only when the D61 rule no longer holds;
--    - `admin_restore_target('user')` restores an admin suspension or a false-report sanction
--      for a moderator, and a ban for a super admin only.

-- ── 1. Catalog ─────────────────────────────────────────────────────────────────
insert into public.fsm_state (machine_id, status) values
  ('account_status', 'pending_verification'),
  ('account_status', 'active'),
  ('account_status', 'suspended_for_false_reports'),
  ('account_status', 'suspended_admin'),
  ('account_status', 'banned'),
  ('account_status', 'pending_deletion');

insert into public.fsm_edge (machine_id, from_status, to_status, role) values
  ('account_status', 'pending_verification', 'active', ''),
  ('account_status', 'pending_verification', 'suspended_for_false_reports', ''),
  ('account_status', 'pending_verification', 'suspended_admin', ''),
  ('account_status', 'pending_verification', 'banned', ''),
  ('account_status', 'pending_verification', 'pending_deletion', ''),
  ('account_status', 'active', 'suspended_for_false_reports', ''),
  ('account_status', 'active', 'suspended_admin', ''),
  ('account_status', 'active', 'banned', ''),
  ('account_status', 'active', 'pending_deletion', ''),
  ('account_status', 'suspended_for_false_reports', 'active', ''),
  ('account_status', 'suspended_for_false_reports', 'suspended_admin', ''),
  ('account_status', 'suspended_for_false_reports', 'banned', ''),
  ('account_status', 'suspended_admin', 'active', ''),
  ('account_status', 'suspended_admin', 'banned', ''),
  ('account_status', 'banned', 'active', ''),
  ('account_status', 'pending_deletion', 'active', ''),
  ('account_status', 'pending_deletion', 'pending_verification', '');

-- ── 2. The D61 report rule ─────────────────────────────────────────────────────
-- True while the open reports on a target meet the threshold that acts on it: 5 distinct
-- reporters within 30 days suspend a user; 3 within 14 days hide a post or a chat (D33, D61).
create or replace function kc_private.report_threshold_reached(p_target_type text, p_target_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select count(distinct r.reporter_id) >= case when p_target_type = 'user' then 5 else 3 end
    from public.reports r
   where r.target_type = p_target_type
     and r.target_id = p_target_id
     and r.status = 'open'
     and r.created_at >= now() - case when p_target_type = 'user'
                                      then interval '30 days' else interval '14 days' end;
$$;

comment on function kc_private.report_threshold_reached(text, uuid) is
  'D33 / D61 (0696): whether the open reports on a target still meet the threshold that acts on it.';

revoke all on function kc_private.report_threshold_reached(text, uuid) from public, anon, authenticated;

-- ── 3. The status trigger ──────────────────────────────────────────────────────
create or replace function kc_private.users_enforce_account_status_fsm()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Same status: not a transition.
  if new.account_status is not distinct from old.account_status then
    return new;
  end if;

  begin
    perform public.fsm_assert_transition('account_status', old.account_status, new.account_status, null);
  exception
    when sqlstate 'P0001' then
      if sqlerrm in ('illegal_transition', 'unknown_state') then
        raise exception 'account_status_transition_invalid'
          using errcode = '23514',
                detail = format('invalid account status transition from %s to %s',
                                old.account_status, new.account_status);
      end if;
      raise;
  end;

  return new;
end;
$$;

comment on function kc_private.users_enforce_account_status_fsm() is
  'FSM wave 3a (0696): users.account_status moves follow machine `account_status` in fsm_edge; raises account_status_transition_invalid (23514) otherwise.';

revoke all on function kc_private.users_enforce_account_status_fsm() from public, anon, authenticated;

drop trigger if exists users_account_status_fsm on public.users;
create trigger users_account_status_fsm
  before update of account_status on public.users
  for each row execute function kc_private.users_enforce_account_status_fsm();

-- ── 4a. admin_ban_user (0037): an account under deletion is not banned ─────────
create or replace function public.admin_ban_user(
  p_target_user_id uuid,
  p_reason         text,
  p_note           text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or not public.is_admin(v_actor) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_actor = p_target_user_id then
    raise exception 'cannot_ban_self' using errcode = 'P0013';
  end if;
  -- An admin cannot ban another admin (privilege-escalation guard, 0037).
  if exists (select 1 from public.users
             where user_id = p_target_user_id and is_super_admin = true) then
    raise exception 'cannot_ban_admin' using errcode = 'P0014';
  end if;
  if p_reason not in ('spam','harassment','policy_violation','other') then
    raise exception 'invalid_ban_reason' using errcode = 'P0015';
  end if;
  -- 0696: the account is leaving; the graph has no move from pending_deletion to banned.
  if exists (select 1 from public.users
             where user_id = p_target_user_id and account_status = 'pending_deletion') then
    raise exception 'account_pending_deletion' using errcode = 'P0018';
  end if;

  -- A permanent ban supersedes any suspension timer (0037).
  update public.users
     set account_status       = 'banned',
         account_status_until = null
   where user_id = p_target_user_id and account_status <> 'banned';
  if not found then
    return;  -- already banned: idempotent, no audit
  end if;

  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (v_actor, 'ban_user', 'user', p_target_user_id,
          jsonb_build_object('reason', p_reason, 'note', p_note, 'permanent', true));
end;
$$;

-- ── 4b. False-report sanctions (0039): never over a heavier state ──────────────
create or replace function public.reports_after_status_change_apply_sanctions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_count        int;
  v_existing     int;
  v_status       text;    -- 0696: the reporter's status before the sanction
  v_suspends     boolean; -- 0696: whether this sanction moves the status
  v_new_level    int;
  v_until        timestamptz;
  v_lock_key     bigint;
begin
  for r in
    select distinct reporter_id
      from new_rows
     where status = 'dismissed_no_violation'
  loop
    v_lock_key := hashtext('mod_sanction_' || r.reporter_id::text)::bigint;
    perform pg_advisory_xact_lock(v_lock_key);

    select count(*) into v_count
      from public.reports
     where reporter_id = r.reporter_id
       and status = 'dismissed_no_violation'
       and resolved_at > now() - interval '30 days'
       and sanction_consumed_at is null;

    if v_count < 5 then
      continue;
    end if;

    select coalesce(false_report_sanction_count, 0), account_status into v_existing, v_status
      from public.users where user_id = r.reporter_id for update;

    v_new_level := least(v_existing + 1, 3);
    v_until := case v_new_level
      when 1 then now() + interval '7 days'
      when 2 then now() + interval '30 days'
      else null  -- open-ended: lifted by an admin restore
    end;
    -- 0696: an admin suspension, a ban or a pending deletion is heavier; the level still counts.
    v_suspends := v_status in ('active', 'pending_verification', 'suspended_for_false_reports');

    update public.users
       set false_report_sanction_count = v_new_level,
           account_status              = case when v_suspends then 'suspended_for_false_reports' else account_status end,
           account_status_until        = case when v_suspends then v_until else account_status_until end
     where user_id = r.reporter_id
       and false_report_sanction_count = v_existing;  -- level guard

    update public.reports
       set sanction_consumed_at = now()
     where reporter_id = r.reporter_id
       and status = 'dismissed_no_violation'
       and resolved_at > now() - interval '30 days'
       and sanction_consumed_at is null;

    insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
    values (null, 'false_report_sanction_applied', 'user', r.reporter_id,
            jsonb_build_object('level', v_new_level, 'until', v_until, 'suspended', v_suspends));
    if v_suspends then
      insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
      values (null, 'suspend_user', 'user', r.reporter_id,
              jsonb_build_object('reason', 'false_reports', 'level', v_new_level));
    end if;
  end loop;

  return null;
end;
$$;

-- ── 4c. admin_dismiss_report (0118): lift by the same rule that imposed ────────
create or replace function public.admin_dismiss_report(p_report_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_target_type   text;
  v_target_id     uuid;
  v_post_status   text;
  v_user_status   text;
  v_chat_removed  timestamptz;
begin
  perform public.admin_assert_role(v_actor, array['super_admin','moderator']);

  select target_type, target_id into v_target_type, v_target_id
    from public.reports
   where report_id = p_report_id and status = 'open'
   for update;
  if not found then
    raise exception 'report_not_open' using errcode = 'P0012';
  end if;

  if v_target_id is not null and v_target_type <> 'none' then
    perform pg_advisory_xact_lock(
      hashtext('mod_target_' || v_target_type || '_' || v_target_id::text)::bigint);
  end if;

  update public.reports
     set status = 'dismissed_no_violation'
   where report_id = p_report_id;
  -- resolved_at / resolved_by: reports_on_status_change (0005); audit: the after trigger (0005).

  if v_target_type = 'none' or v_target_id is null then
    return;
  end if;

  -- 0696: the action stands while the D61 rule that imposed it still holds.
  if kc_private.report_threshold_reached(v_target_type, v_target_id) then
    return;
  end if;

  -- Below the threshold and still in the automatic action's state: restore.
  if v_target_type = 'post' then
    select status into v_post_status from public.posts where post_id = v_target_id;
    if v_post_status in ('removed_admin', 'hidden_pending_review') then
      perform public.admin_restore_target('post', v_target_id);
    end if;
  elsif v_target_type = 'user' then
    select account_status into v_user_status from public.users where user_id = v_target_id;
    if v_user_status = 'suspended_admin' then
      perform public.admin_restore_target('user', v_target_id);
    end if;
  elsif v_target_type = 'chat' then
    select removed_at into v_chat_removed from public.chats where chat_id = v_target_id;
    if v_chat_removed is not null then
      perform public.admin_restore_target('chat', v_target_id);
    end if;
  end if;
end;
$$;

-- ── 4d. admin_restore_target (0682): suspensions for moderators, bans for super admins ──
create or replace function public.admin_restore_target(p_target_type text, p_target_id uuid)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_actor       uuid := auth.uid();
  v_changed     boolean := false;
  v_reporters   uuid[];
  v_user_status text;  -- 0696: the user's status before the restore
begin
  perform public.admin_assert_role(v_actor, array['super_admin','moderator']);

  if p_target_type not in ('post','user','chat','listing') then
    raise exception 'invalid_target_type' using errcode = 'P0010';
  end if;

  if p_target_type = 'post' then
    if not exists (select 1 from public.posts where post_id = p_target_id) then
      raise exception 'target_not_found' using errcode = 'P0017', detail = 'post';
    end if;
  elsif p_target_type = 'user' then
    if not exists (select 1 from public.users where user_id = p_target_id) then
      raise exception 'target_not_found' using errcode = 'P0017', detail = 'user';
    end if;
  elsif p_target_type = 'chat' then
    if not exists (select 1 from public.chats where chat_id = p_target_id) then
      raise exception 'target_not_found' using errcode = 'P0017', detail = 'chat';
    end if;
  elsif p_target_type = 'listing' then
    if not exists (select 1 from public.listings where listing_id = p_target_id) then
      raise exception 'target_not_found' using errcode = 'P0017', detail = 'listing';
    end if;
  end if;

  if p_target_type = 'post' then
    -- Only a removed or hidden post is restored; any other status is a no-op.
    update public.posts p
       set status = kc_private.post_restore_status(p),
           status_before_admin_removal = null,
           moderation_status = 'published',
           updated_at = now()
     where p.post_id = p_target_id
       and p.status in ('removed_admin', 'hidden_pending_review');
    v_changed := found;
  elsif p_target_type = 'user' then
    select account_status into v_user_status from public.users where user_id = p_target_id for update;
    -- 0696: an admin suspension or a false-report sanction for a moderator; a ban for a super
    -- admin only; an active account is a no-op; anything else is not restorable here.
    if v_user_status not in ('suspended_admin', 'suspended_for_false_reports', 'banned', 'active') then
      raise exception 'invalid_restore_state'
        using errcode = 'P0011', detail = 'user is not suspended or banned';
    end if;
    if v_user_status = 'banned' then
      perform public.admin_assert_role(v_actor, array['super_admin']);
    end if;
    update public.users
       set account_status = 'active',
           account_status_until = null
     where user_id = p_target_id
       and account_status in ('suspended_admin', 'suspended_for_false_reports', 'banned');
    v_changed := found;
  elsif p_target_type = 'chat' then
    update public.chats set removed_at = null
     where chat_id = p_target_id and removed_at is not null;
    v_changed := found;
  elsif p_target_type = 'listing' then
    -- `listings` is a view over `posts` (0667): restoring the post restores the listing.
    update public.posts p
       set status = kc_private.post_restore_status(p),
           status_before_admin_removal = null,
           updated_at = now()
     where (p.listing_id = p_target_id or p.legacy_listing_id = p_target_id or p.post_id = p_target_id)
       and p.status in ('removed_admin', 'hidden_pending_review');
    v_changed := found;
  end if;

  if not v_changed then return; end if;

  select coalesce(array_agg(distinct reporter_id order by reporter_id), array[]::uuid[])
    into v_reporters
    from public.reports
   where target_type = p_target_type
     and target_id   = p_target_id
     and status      = 'open';

  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (v_actor, 'restore_target', p_target_type, p_target_id,
          jsonb_build_object('distinct_reporters', to_jsonb(v_reporters), 'from_status', v_user_status));
end;
$$;
