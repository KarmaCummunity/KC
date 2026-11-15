-- 0078_backfill_report_received_target_preview | TD-152
--
-- One-shot backfill of `messages.system_payload.target_preview` (and the
-- companion `link_target` field) for `report_received` system messages
-- that pre-date migration 0047 (which started writing the enriched payload
-- at INSERT time).
--
-- Without this backfill those legacy rows render in ReportReceivedBubble
-- as title-only ("Spam · post") — cosmetic only, no data loss.
--
-- Idempotent: the WHERE clause excludes rows that already have a non-null
-- target_preview, so re-running this migration after it lands is a no-op.
-- Safe to re-run if needed.
--
-- The preview shape mirrors `reports_after_insert_apply_effects` in 0047:
--   * target_type='post' → { kind:'post', author_handle, author_display_name,
--                            body_snippet, has_image }
--   * target_type='user' → { kind:'user', handle, display_name, bio_snippet }
--   * target_type='chat' → { kind:'user', handle, display_name, bio_snippet }
--                          using the chat counterpart (reporter's opposite).
--                          Excludes support threads (counterpart = admin).
--   * target_type='none' → row is skipped (no preview to compute).
--
-- Any row whose target has since been hard-deleted will be left with
-- target_preview=null (LEFT JOIN missing → null) and continue to render
-- in degraded mode — accepted, no rollback needed.

begin;

-- Helper CTE: extract (message_id, report_id, target_type, target_id, reporter_id)
-- for legacy report_received rows that still need a preview.
with legacy as (
  select
    m.message_id,
    (m.system_payload ->> 'report_id')::uuid    as report_id,
    (m.system_payload ->> 'target_type')        as target_type,
    nullif(m.system_payload ->> 'target_id','') as target_id_text,
    r.reporter_id
  from public.messages m
  -- The original payload always has report_id; rows without it predate this
  -- code path entirely and aren't fixable here.
  join public.reports r on r.report_id = (m.system_payload ->> 'report_id')::uuid
  where m.kind = 'report_received'
    and (m.system_payload -> 'target_preview') is null
    and (m.system_payload ->> 'report_id') is not null
),

-- Compute target_preview for each legacy row by branching on target_type.
-- LEFT JOINs handle the post/user-deleted case (preview stays null).
previews as (
  -- Post-target preview.
  select
    l.message_id,
    jsonb_build_object(
      'type',   'post',
      'id',     p.post_id,
      'handle', u.share_handle
    ) as link_target,
    jsonb_build_object(
      'kind',                'post',
      'author_handle',       u.share_handle,
      'author_display_name', u.display_name,
      'body_snippet', nullif(trim(regexp_replace(
        left(p.title || coalesce(' — ' || p.description, ''), 80),
        '\s+', ' ', 'g'
      )), ''),
      'has_image', exists (select 1 from public.media_assets ma where ma.post_id = p.post_id)
    ) as target_preview
  from legacy l
  join public.posts p on p.post_id = l.target_id_text::uuid
  join public.users u on u.user_id = p.owner_id
  where l.target_type = 'post'

  union all

  -- User-target preview.
  select
    l.message_id,
    jsonb_build_object(
      'type',   'user',
      'id',     u.user_id,
      'handle', u.share_handle
    ),
    jsonb_build_object(
      'kind',         'user',
      'handle',       u.share_handle,
      'display_name', u.display_name,
      'bio_snippet',  nullif(trim(regexp_replace(
        left(coalesce(u.biography, ''), 80),
        '\s+', ' ', 'g'
      )), '')
    )
  from legacy l
  join public.users u on u.user_id = l.target_id_text::uuid
  where l.target_type = 'user'

  union all

  -- Chat-target preview (use the reporter's counterpart; skip support threads).
  select
    l.message_id,
    jsonb_build_object(
      'type',   'user',
      'id',     u.user_id,
      'handle', u.share_handle
    ),
    jsonb_build_object(
      'kind',         'user',
      'handle',       u.share_handle,
      'display_name', u.display_name,
      'bio_snippet',  nullif(trim(regexp_replace(
        left(coalesce(u.biography, ''), 80),
        '\s+', ' ', 'g'
      )), '')
    )
  from legacy l
  join public.chats c on c.chat_id = l.target_id_text::uuid
  join public.users u
       on u.user_id = case when c.participant_a = l.reporter_id
                           then c.participant_b
                           else c.participant_a end
  where l.target_type = 'chat'
    and coalesce(c.is_support_thread, false) = false
)

update public.messages m
   set system_payload = m.system_payload
                        || jsonb_build_object(
                             'link_target',    pv.link_target,
                             'target_preview', pv.target_preview
                           )
  from previews pv
 where m.message_id = pv.message_id
   and pv.target_preview is not null;

commit;
