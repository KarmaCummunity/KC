-- 0129_reports_validate_already_moderated_error | FR-MOD-001 — closes TD-94 (2)
--
-- Today, a user reporting a target that's already been moderated (post
-- removed_admin, user suspended_admin/banned, chat soft-removed) hits the
-- generic 'report_target_not_visible' error in reports_validate_before_insert.
-- That message is confusing — the target was visible a moment ago. Surface
-- a distinct error so the client can render a clear "already handled"
-- toast instead of a misleading "not visible" one.
--
-- Public contract:
--   SQLSTATE = 'P0020'   (first free P-class slot above the existing range
--                         P0010..P0017 used by admin RPCs).
--   message  = 'target_already_moderated'
--
-- The new checks fire BEFORE the existing visibility check, so a target
-- that's both moderated AND privately-gated returns the more specific
-- 'already moderated' signal (the user can't fix that anyway). The
-- visibility error stays the fallback for true privacy gating (regression
-- coverage: test 5 in hardeningRpc.integration.test.ts).
--
-- 'cannot_report_self' (existing P0... err, check_violation) is intentionally
-- not reordered — self-reports are still the most urgent signal to surface
-- before any other validation.
--
-- account_status enum values for 'user' targets (verified against 0001):
--   'pending_verification','active','suspended_for_false_reports',
--   'suspended_admin','banned','deleted'
-- Of these, 'suspended_admin' and 'banned' are moderation-terminal states
-- the reporter cannot affect via further reports. 'suspended_for_false_reports'
-- is the *reporter* sanction state and is NOT a moderation outcome on the
-- target — reporting such a user should still proceed normally.
-- 'deleted' is the RTBF tombstone; visibility check handles it.
--
-- Every other line in the function is preserved verbatim from 0005:
--   reporter_must_be_self, target sanity per type, cannot_report_self,
--   24h dedup with 'duplicate_report' / unique_violation. Trigger binding
--   reports_before_insert (created in 0005) targets this function name.

create or replace function public.reports_validate_before_insert()
returns trigger
language plpgsql
as $$
begin
  if new.reporter_id is null or new.reporter_id <> auth.uid() then
    -- Belt-and-braces; the RLS policy is the primary enforcer.
    raise exception 'reporter_must_be_self' using errcode = 'check_violation';
  end if;

  -- TD-94 (2): already-moderated targets surface a distinct, actionable
  -- error. Runs BEFORE the visibility check so the user sees the more
  -- specific signal even when the target also happens to be hidden by
  -- visibility (e.g. a moderated post that the reporter wouldn't otherwise
  -- see).
  if new.target_type = 'post' and exists (
    select 1 from public.posts
     where post_id = new.target_id
       and status  = 'removed_admin'
  ) then
    raise exception 'target_already_moderated'
      using errcode = 'P0020', detail = 'target_type=post';
  end if;

  if new.target_type = 'user' and exists (
    select 1 from public.users
     where user_id        = new.target_id
       and account_status in ('suspended_admin','banned')
  ) then
    raise exception 'target_already_moderated'
      using errcode = 'P0020', detail = 'target_type=user';
  end if;

  if new.target_type = 'chat' and exists (
    select 1 from public.chats
     where chat_id    = new.target_id
       and removed_at is not null
  ) then
    raise exception 'target_already_moderated'
      using errcode = 'P0020', detail = 'target_type=chat';
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
