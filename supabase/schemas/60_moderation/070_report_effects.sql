-- Moderation · what a new report does (FR-MOD-001 AC5, D33, D61, D134)
--
-- In the transaction of the report: the target is hidden from its reporter, the report is
-- audited, and when enough distinct members hold an open report on the same target the
-- automatic action runs — a post is hidden until a human reviews it, a member is suspended
-- from acting, a chat is handed to the messaging module to hide. Comments have no automatic
-- action: a reported comment waits for staff. The reporters are never told (FR-MOD-005 AC4).

-- True while the open reports on a target meet the threshold that acts on it. The same
-- rule imposes the action and, once a dismissal brings the count below it, lifts it (D134).
create function kc_private.report_threshold_reached(p_target_type text, p_target_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_target_type <> 'comment'
     and (select count(distinct r.reporter_id)
            from public.reports r
           where r.target_type = p_target_type and r.target_id = p_target_id and r.status = 'open'
             and r.created_at > now() - case p_target_type when 'user' then s.user_suspend_window
                                                           else s.content_hide_window end)
         >= case p_target_type when 'user' then s.user_suspend_reporters else s.content_hide_reporters end
    from kc_private.moderation_settings s;
$$;
comment on function kc_private.report_threshold_reached(text, uuid) is
  'Whether enough distinct reporters hold an open report on the target for the automatic action.';

-- Sends one notification event to every active moderator, admin and super admin.
create function kc_private.notify_moderators(p_kind text, p_entity_type text, p_entity_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  select kc_private.outbox_enqueue('notification', jsonb_build_object(
           'kind', p_kind, 'recipient_id', staff.user_id, 'actor_id', null,
           'entity', jsonb_build_object('type', p_entity_type, 'id', p_entity_id),
           'data', jsonb_build_object('dedupe_key', p_kind || ':' || p_entity_id || ':' || staff.user_id)))
    from (select distinct g.user_id
            from public.admin_role_grants g
            join kc_private.admin_roles r on r.role = g.role and r.is_platform
            join kc_private.admin_roles m on m.role = 'moderator'
           where g.revoked_at is null and r.rank >= m.rank) staff;
$$;
comment on function kc_private.notify_moderators(text, text, uuid) is
  'Enqueues a notification for each member of the moderation staff.';

-- Sends one notification event to a member about something staff or a rule did.
create function kc_private.notify_moderation_outcome(p_kind text, p_recipient_id uuid, p_post_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  select kc_private.outbox_enqueue('notification', jsonb_build_object(
    'kind', p_kind, 'recipient_id', p_recipient_id, 'actor_id', null,
    'entity', jsonb_build_object('type', 'post', 'id', p_post_id),
    'data', jsonb_build_object('post_id', p_post_id)));
$$;

create function kc_private.reports_apply_effects()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.posts;
begin
  -- Reports on one target are processed one at a time, so two reports arriving together
  -- cannot both miss the threshold.
  perform pg_advisory_xact_lock(hashtextextended('report:' || new.target_type || ':' || new.target_id, 0));

  insert into public.report_hides (reporter_id, target_type, target_id)
  values (new.reporter_id, new.target_type, new.target_id)
  on conflict do nothing;
  perform kc_private.audit_record(
    'report_target', new.target_type, new.target_id,
    jsonb_build_object('report_id', new.id, 'reason', new.reason), new.reporter_id);

  if not kc_private.report_threshold_reached(new.target_type, new.target_id) then
    return null;
  end if;

  if new.target_type = 'post' then
    select p.* into v_post from public.posts p where p.id = new.target_id for update;
    if v_post.status not in ('open', 'paused', 'closed_delivered', 'expired') then
      return null;
    end if;
    perform kc_private.post_move(new.target_id, 'hidden_pending_review', 'system');
    perform kc_private.notify_moderation_outcome('post_hidden_for_review', v_post.owner_id, v_post.id);
  elsif new.target_type = 'user' then
    -- A member who is already suspended by staff, banned or leaving is not moved: the
    -- report still counts and the case still reaches staff.
    if exists (select 1 from public.user_account a
                where a.user_id = new.target_id
                  and a.status in ('active', 'pending_verification', 'suspended_for_false_reports')) then
      perform kc_private.account_sanction(new.target_id, 'suspended_admin', 'report_threshold', null, null, null);
    end if;
  end if;

  -- One review entry per case; staff are notified, and a chat is hidden, once per entry.
  if kc_private.moderation_enqueue(new.target_type, new.target_id, 'report_threshold') then
    perform kc_private.audit_record(
      'auto_remove_target', new.target_type, new.target_id,
      jsonb_build_object('outcome', case new.target_type when 'post' then 'hidden_pending_review'
                                                         when 'user' then 'suspended_admin'
                                                         else 'hide_requested' end), null);
    perform kc_private.notify_moderators('moderation_review_needed', new.target_type, new.target_id);
    if new.target_type = 'chat' then
      perform kc_private.outbox_enqueue('moderation_target', jsonb_build_object(
        'kind', 'hide', 'target_type', 'chat', 'target_id', new.target_id));
    end if;
  end if;
  return null;
end;
$$;
comment on function kc_private.reports_apply_effects() is
  'AFTER INSERT on reports: reporter hide, audit row and the automatic action at the threshold.';

create trigger reports_apply_effects
  after insert on public.reports
  for each row execute function kc_private.reports_apply_effects();

-- Notification kinds this module emits, registered so delivery accepts them
-- (kc_private.notification_kinds, 50_notifications). Hidden and removed notices bypass
-- preferences: a member must learn that their post is no longer shown (FR-MOD-005).
insert into kc_private.notification_kinds
  (kind, category, bypass_preferences, title_key, body_key)
values
  ('post_hidden_for_review', 'critical', true, 'notifications.postHiddenForReviewTitle', 'notifications.postHiddenForReviewBody'),
  ('post_removed', 'critical', true, 'notifications.postRemovedTitle', 'notifications.postRemovedBody'),
  ('post_restored', 'critical', false, 'notifications.postRestoredTitle', 'notifications.postRestoredBody'),
  ('moderation_review_needed', 'critical', false, 'notifications.moderationReviewNeededTitle', 'notifications.moderationReviewNeededBody');
