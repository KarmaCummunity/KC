-- WhatsApp bot · the staff console (M22 / L7, #939)
--
-- The RPCs of the admin WhatsApp screen, with the pre-baseline names. Moderator and above
-- (kc_private.require_admin_role), except the two configuration writers (send limits and a
-- template's Meta status), which are super admin. Phone numbers are always masked. Lists are
-- keyset-paged: each row carries the `cursor` that continues after it.
--
-- Audit (audit.events, ids and codes only): whatsapp_channel_toggle, whatsapp_resend,
-- whatsapp_block_user, whatsapp_review_resolve, whatsapp_send_limits_set,
-- whatsapp_template_status_set.
--
-- Errors (P0001 unless noted): forbidden (42501), enabled_required, channel_missing,
-- invalid_status, outbound_not_found, not_resendable, user_id_required, review_not_found,
-- invalid_decision, invalid_transition, invalid_limits, template_not_found.

-- ── Channel switch ──────────────────────────────────────────────────────────
create function kc_private.whatsapp_channel_json()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select jsonb_build_object('is_enabled', c.is_enabled, 'phone_number_id', c.phone_number_id,
                                             'graph_api_version', c.graph_api_version, 'updated_at', c.updated_at,
                                             'updated_by', c.updated_by)
                     from integrations.whatsapp_channel_config c where c.id),
                  jsonb_build_object('is_enabled', false, 'phone_number_id', null, 'graph_api_version', null,
                                     'updated_at', null, 'updated_by', null));
$$;

create function public.api_whatsapp_admin_get_channel()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform kc_private.require_admin_role('moderator');
  return kc_private.whatsapp_channel_json();
end;
$$;
comment on function public.api_whatsapp_admin_get_channel() is 'Staff (moderator+): the WhatsApp channel switch and settings.';
grant execute on function public.api_whatsapp_admin_get_channel() to authenticated;

-- Turns the channel on or off (kill switch); audited, and kept in the consent history.
create function public.api_whatsapp_admin_set_channel_enabled(p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.require_admin_role('moderator');
begin
  if p_enabled is null then
    raise exception 'enabled_required' using errcode = 'P0001';
  end if;
  update integrations.whatsapp_channel_config c set is_enabled = p_enabled, updated_by = v_actor where c.id;
  if not found then
    raise exception 'channel_missing' using errcode = 'P0001';
  end if;
  insert into integrations.whatsapp_consent_events (user_id, action, source, keyword)
  values (v_actor, case when p_enabled then 'opt_in' else 'opt_out' end, 'admin',
          case when p_enabled then 'kill_switch_enable' else 'kill_switch_disable' end);
  perform kc_private.audit_record('whatsapp_channel_toggle', null, null, jsonb_build_object('enabled', p_enabled), v_actor);
  return kc_private.whatsapp_channel_json();
end;
$$;
comment on function public.api_whatsapp_admin_set_channel_enabled(boolean) is 'Staff (moderator+): WhatsApp kill switch; audited.';
grant execute on function public.api_whatsapp_admin_set_channel_enabled(boolean) to authenticated;

-- ── Overview ────────────────────────────────────────────────────────────────
-- Seven days of outbound outcomes, consent totals, sessions, matches sent, live rate-limit
-- hits and the pending review queue.
create function public.api_whatsapp_admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_since constant timestamptz := now() - interval '7 days';
  v_out record;
begin
  perform kc_private.require_admin_role('moderator');
  select count(*) filter (where o.status = 'queued') as queued, count(*) filter (where o.status = 'sent') as sent,
         count(*) filter (where o.status = 'failed') as failed, count(*) filter (where o.status like 'skipped\_%') as skipped,
         count(*) filter (where o.status = 'sent' and o.template_name = 'match_found_v1') as matches
    into v_out
    from integrations.whatsapp_outbound_messages o where o.created_at >= v_since;
  return jsonb_build_object(
    'channel_enabled', kc_private.whatsapp_channel_enabled(), 'since', v_since,
    'outbound_queued', v_out.queued, 'outbound_sent', v_out.sent, 'outbound_failed', v_out.failed,
    'outbound_skipped', v_out.skipped,
    'consent_opted_in', (select count(*) from integrations.whatsapp_consents c where c.opted_in),
    'consent_opted_out', (select count(*) from integrations.whatsapp_consents c where not c.opted_in),
    'sessions_7d', (select count(*) from integrations.bot_conversation_sessions s where s.updated_at >= v_since),
    'matches_sent_7d', v_out.matches,
    'rate_hits_7d', (select coalesce(sum(c.hits), 0) from kc_private.rate_limit_counters c where c.key like 'wa\_%'),
    'review_pending', (select count(*) from integrations.bot_review_items r where r.status = 'pending'));
end;
$$;
comment on function public.api_whatsapp_admin_overview() is 'Staff (moderator+): seven-day WhatsApp metrics.';
grant execute on function public.api_whatsapp_admin_overview() to authenticated;

-- ── Lists ───────────────────────────────────────────────────────────────────
-- Numbers with their consent, most recently changed first. Cursor {at, id}.
create function public.api_whatsapp_admin_list_consent(p_cursor jsonb default null, p_limit integer default 50)
returns table (identity_id uuid, user_id uuid, wa_id_masked text, consent_status text, opted_in boolean,
               opted_in_at timestamptz, opted_out_at timestamptz, preferred_language text,
               last_inbound_at timestamptz, updated_at timestamptz, cursor jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform kc_private.require_admin_role('moderator');
  return query
  select i.id, i.user_id, kc_private.whatsapp_mask(i.wa_id), i.consent_status, coalesce(c.opted_in, false),
         c.opted_in_at, c.opted_out_at, i.preferred_language, i.last_inbound_at, k.at,
         jsonb_build_object('at', k.at, 'id', i.id)
    from integrations.whatsapp_identities i
    left join integrations.whatsapp_consents c on c.user_id = i.user_id
   cross join lateral (select greatest(i.updated_at, coalesce(c.updated_at, i.updated_at)) as at) k
   where p_cursor is null or (k.at, i.id) < ((p_cursor ->> 'at')::timestamptz, (p_cursor ->> 'id')::uuid)
   order by k.at desc, i.id desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;
comment on function public.api_whatsapp_admin_list_consent(jsonb, integer) is 'Staff (moderator+): WhatsApp numbers and consent, keyset-paged.';
grant execute on function public.api_whatsapp_admin_list_consent(jsonb, integer) to authenticated;

-- Outbound messages of the last seven days, newest first, optionally of one status.
-- Cursor {created_at, id}.
create function public.api_whatsapp_admin_list_outbound(
  p_status text default null, p_cursor jsonb default null, p_limit integer default 50)
returns table (outbound_id uuid, user_id uuid, wa_id_masked text, kind text, template_name text, language text,
               status text, attempts integer, last_error text, created_at timestamptz, sent_at timestamptz,
               next_attempt_at timestamptz, cursor jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform kc_private.require_admin_role('moderator');
  if p_status is not null and p_status not in (
       'queued', 'sending', 'sent', 'failed', 'skipped_rate_limit', 'skipped_no_consent', 'skipped_outside_window',
       'skipped_template_unapproved', 'skipped_no_identity', 'skipped_global_cap', 'skipped_channel_disabled') then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
  return query
  select o.id, o.user_id, kc_private.whatsapp_mask(o.to_wa_id), o.kind, o.template_name, o.language, o.status,
         o.attempts, o.last_error, o.created_at, o.sent_at, o.next_attempt_at,
         jsonb_build_object('created_at', o.created_at, 'id', o.id)
    from integrations.whatsapp_outbound_messages o
   where o.created_at >= now() - interval '7 days'
     and (p_status is null or o.status = p_status)
     and (p_cursor is null
          or (o.created_at, o.id) < ((p_cursor ->> 'created_at')::timestamptz, (p_cursor ->> 'id')::uuid))
   order by o.created_at desc, o.id desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;
comment on function public.api_whatsapp_admin_list_outbound(text, jsonb, integer) is
  'Staff (moderator+): WhatsApp outbound messages of the last 7 days, keyset-paged.';
grant execute on function public.api_whatsapp_admin_list_outbound(text, jsonb, integer) to authenticated;

-- Live WhatsApp rate-limit counters (keys `wa_…`), busiest first. A key names the limited
-- subject; a number inside it is masked.
create function public.api_whatsapp_admin_list_rate_hits(p_limit integer default 50)
returns table (bucket text, window_start timestamptz, expires_at timestamptz, hits integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform kc_private.require_admin_role('moderator');
  return query
  select case when position(':' in c.key) > 0
              then split_part(c.key, ':', 1) || ':' || kc_private.whatsapp_mask(split_part(c.key, ':', 2))
              else c.key end,
         c.window_start, c.expires_at, c.hits
    from kc_private.rate_limit_counters c
   where c.key like 'wa\_%'
   order by c.window_start desc, c.hits desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;
comment on function public.api_whatsapp_admin_list_rate_hits(integer) is 'Staff (moderator+): live WhatsApp rate-limit counters.';
grant execute on function public.api_whatsapp_admin_list_rate_hits(integer) to authenticated;

-- Match alerts of the last seven days (found and handoff confirmations), newest first.
create function public.api_whatsapp_admin_list_recent_matches(p_limit integer default 50)
returns table (outbound_id uuid, user_id uuid, wa_id_masked text, template_name text, language text,
               status text, payload jsonb, created_at timestamptz, sent_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform kc_private.require_admin_role('moderator');
  return query
  select o.id, o.user_id, kc_private.whatsapp_mask(o.to_wa_id), o.template_name, o.language, o.status, o.payload,
         o.created_at, o.sent_at
    from integrations.whatsapp_outbound_messages o
   where o.created_at >= now() - interval '7 days'
     and o.template_name in ('match_found_v1', 'confirm_handoff_v1')
   order by o.created_at desc, o.id desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;
comment on function public.api_whatsapp_admin_list_recent_matches(integer) is 'Staff (moderator+): WhatsApp match alerts of the last 7 days.';
grant execute on function public.api_whatsapp_admin_list_recent_matches(integer) to authenticated;

-- Bot conversations active in the last seven days, most recent first.
create function public.api_whatsapp_admin_list_conversations(p_limit integer default 50)
returns table (session_id uuid, wa_id_masked text, user_id uuid, state text, post_id uuid, confidence numeric,
               updated_at timestamptz, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform kc_private.require_admin_role('moderator');
  return query
  select s.id, kc_private.whatsapp_mask(i.wa_id), i.user_id, s.state, s.post_id, s.confidence, s.updated_at,
         s.created_at
    from integrations.bot_conversation_sessions s
    join integrations.whatsapp_identities i on i.id = s.identity_id
   where s.updated_at >= now() - interval '7 days'
   order by s.updated_at desc, s.id desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;
comment on function public.api_whatsapp_admin_list_conversations(integer) is 'Staff (moderator+): recent WhatsApp bot conversations.';
grant execute on function public.api_whatsapp_admin_list_conversations(integer) to authenticated;

-- Message templates and their Meta approval state.
create function public.api_whatsapp_admin_list_templates()
returns table (template_name text, language_code text, category text, body_preview text, params jsonb,
               registry_version integer, is_approved boolean, meta_status text, meta_template_id text,
               updated_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform kc_private.require_admin_role('moderator');
  return query
  select t.template_name, t.language_code, t.category, t.body_preview, t.params, t.registry_version, t.is_approved,
         t.meta_status, t.meta_template_id, t.updated_at
    from integrations.whatsapp_message_templates t
   order by t.template_name, t.language_code;
end;
$$;
comment on function public.api_whatsapp_admin_list_templates() is 'Staff (moderator+): WhatsApp templates and their Meta status.';
grant execute on function public.api_whatsapp_admin_list_templates() to authenticated;

-- ── Actions on messages and members ─────────────────────────────────────────
-- Queues a failed or skipped-for-capacity message again, attempts reset; audited.
create function public.api_whatsapp_admin_resend(p_outbound_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.require_admin_role('moderator');
  v_status text;
begin
  select o.status into v_status from integrations.whatsapp_outbound_messages o where o.id = p_outbound_id for update;
  if not found then
    raise exception 'outbound_not_found' using errcode = 'P0001';
  end if;
  if v_status not in ('failed', 'skipped_rate_limit', 'skipped_global_cap', 'skipped_outside_window') then
    raise exception 'not_resendable' using errcode = 'P0001';
  end if;
  update integrations.whatsapp_outbound_messages o
     set status = 'queued', next_attempt_at = now(), claimed_at = null, last_error = null, attempts = 0
   where o.id = p_outbound_id;
  perform kc_private.audit_record('whatsapp_resend', 'whatsapp_outbound', p_outbound_id,
                                  jsonb_build_object('from_status', v_status), v_actor);
  return 'queued';
end;
$$;
comment on function public.api_whatsapp_admin_resend(uuid) is 'Staff (moderator+): queues a failed WhatsApp message again; audited.';
grant execute on function public.api_whatsapp_admin_resend(uuid) to authenticated;

-- Stops every WhatsApp message to a member: alert consent off, their numbers opted out,
-- queued templates cancelled; audited.
create function public.api_whatsapp_admin_block_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.require_admin_role('moderator');
begin
  if p_user_id is null then
    raise exception 'user_id_required' using errcode = 'P0001';
  end if;
  perform kc_private.whatsapp_set_user_consent(p_user_id, false, 'admin', 'block');
  update integrations.whatsapp_outbound_messages o
     set status = 'skipped_no_consent', last_error = 'admin_block'
   where o.user_id = p_user_id and o.status = 'queued' and o.kind = 'template';
  perform kc_private.audit_record('whatsapp_block_user', 'user', p_user_id, '{}'::jsonb, v_actor);
end;
$$;
comment on function public.api_whatsapp_admin_block_user(uuid) is 'Staff (moderator+): stops WhatsApp messages to a member; audited.';
grant execute on function public.api_whatsapp_admin_block_user(uuid) to authenticated;

-- ── Review queue of bot posts ───────────────────────────────────────────────
-- Review items of one status (default pending), newest first. Cursor {created_at, id}.
create function public.api_whatsapp_admin_review_list(
  p_status text default 'pending', p_cursor jsonb default null, p_limit integer default 50)
returns table (review_id uuid, session_id uuid, post_id uuid, post_title text, post_status text, owner_id uuid,
               reason text, status text, confidence numeric, reviewer_id uuid, created_at timestamptz,
               resolved_at timestamptz, cursor jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform kc_private.require_admin_role('moderator');
  if p_status is not null and p_status not in ('pending', 'approved', 'rejected') then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
  return query
  select r.id, r.session_id, r.post_id, p.title, p.status, p.owner_id, r.reason, r.status, s.confidence,
         r.reviewer_id, r.created_at, r.resolved_at, jsonb_build_object('created_at', r.created_at, 'id', r.id)
    from integrations.bot_review_items r
    left join public.posts p on p.id = r.post_id
    left join integrations.bot_conversation_sessions s on s.id = r.session_id
   where (p_status is null or r.status = p_status)
     and (p_cursor is null
          or (r.created_at, r.id) < ((p_cursor ->> 'created_at')::timestamptz, (p_cursor ->> 'id')::uuid))
   order by r.created_at desc, r.id desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;
comment on function public.api_whatsapp_admin_review_list(text, jsonb, integer) is
  'Staff (moderator+): the review queue of WhatsApp bot posts, keyset-paged.';
grant execute on function public.api_whatsapp_admin_review_list(text, jsonb, integer) to authenticated;

-- Decides a review item. Approving publishes its draft post for the owner (an offer in a
-- photo world still needs its photo, offer_photo_required); rejecting leaves the draft to
-- its owner. Returns the decision; audited.
create function public.api_whatsapp_admin_review_resolve(p_review_id uuid, p_decision text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.require_admin_role('moderator');
  v_item integrations.bot_review_items;
begin
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'invalid_decision' using errcode = 'P0001';
  end if;
  select r.* into v_item from integrations.bot_review_items r where r.id = p_review_id for update;
  if not found then
    raise exception 'review_not_found' using errcode = 'P0001';
  end if;
  if v_item.status <> 'pending' then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;
  if p_decision = 'approved' and v_item.post_id is not null
     and (select p.status from public.posts p where p.id = v_item.post_id) = 'draft' then
    perform kc_private.post_require_offer_photo(v_item.post_id);
    perform kc_private.post_move(v_item.post_id, 'open', 'owner');
  end if;
  update integrations.bot_review_items r
     set status = p_decision, reviewer_id = v_actor, resolved_at = now()
   where r.id = p_review_id;
  perform kc_private.audit_record('whatsapp_review_resolve', 'whatsapp_review', p_review_id,
                                  jsonb_build_object('decision', p_decision, 'post_id', v_item.post_id), v_actor);
  return p_decision;
end;
$$;
comment on function public.api_whatsapp_admin_review_resolve(uuid, text) is
  'Staff (moderator+): approves (publishes) or rejects a WhatsApp bot post under review; audited.';
grant execute on function public.api_whatsapp_admin_review_resolve(uuid, text) to authenticated;

-- ── Configuration ───────────────────────────────────────────────────────────
-- Reads the send limits for the console (moderator+); only a super admin may change them.
create function public.api_whatsapp_admin_get_send_limits()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform kc_private.require_admin_role('moderator');
  return (select to_jsonb(l) - 'id' from integrations.whatsapp_send_limits l where l.id);
end;
$$;
comment on function public.api_whatsapp_admin_get_send_limits() is 'Staff (moderator+): the current WhatsApp send limits.';
grant execute on function public.api_whatsapp_admin_get_send_limits() to authenticated;

-- Writers (super admin).
-- Patches the send limits from a JSON object of known integer fields; returns the row.
create function public.api_whatsapp_admin_set_send_limits(p_limits jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.require_admin_role('super_admin');
  v_fields constant text[] := array['per_user_hour', 'per_user_day', 'reply_per_phone_hour', 'global_per_minute',
    'global_template_recipients_day', 'inbound_per_phone_minute', 'llm_per_phone_day', 'llm_global_day',
    'max_attempts', 'backoff_base_seconds'];
  v_new integrations.whatsapp_send_limits;
begin
  if p_limits is null or jsonb_typeof(p_limits) <> 'object' or p_limits = '{}'::jsonb
     or exists (select 1 from jsonb_each(p_limits) e
                 where e.key <> all (v_fields) or jsonb_typeof(e.value) <> 'number') then
    raise exception 'invalid_limits' using errcode = 'P0001';
  end if;
  begin
    update integrations.whatsapp_send_limits l
       set (per_user_hour, per_user_day, reply_per_phone_hour, global_per_minute, global_template_recipients_day,
            inbound_per_phone_minute, llm_per_phone_day, llm_global_day, max_attempts, backoff_base_seconds,
            updated_by) =
           (select r.per_user_hour, r.per_user_day, r.reply_per_phone_hour, r.global_per_minute,
                   r.global_template_recipients_day, r.inbound_per_phone_minute, r.llm_per_phone_day, r.llm_global_day,
                   r.max_attempts, r.backoff_base_seconds, v_actor
              from jsonb_populate_record(l, p_limits) r)
     where l.id
    returning l.* into v_new;
  exception when check_violation or invalid_text_representation or numeric_value_out_of_range then
    raise exception 'invalid_limits' using errcode = 'P0001';
  end;
  perform kc_private.audit_record('whatsapp_send_limits_set', null, null, p_limits, v_actor);
  return to_jsonb(v_new) - 'id';
end;
$$;
comment on function public.api_whatsapp_admin_set_send_limits(jsonb) is 'Super admin: tunes the WhatsApp send limits; audited.';
grant execute on function public.api_whatsapp_admin_set_send_limits(jsonb) to authenticated;

-- Records a template's Meta status (approved makes it sendable) and its Meta id; audited.
create function public.api_whatsapp_admin_set_template_status(
  p_template_name text, p_language_code text, p_meta_status text, p_meta_template_id text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor constant uuid := kc_private.require_admin_role('super_admin');
  v_id uuid;
begin
  if p_meta_status is null or p_meta_status not in
     ('draft', 'submitted', 'approved', 'rejected', 'paused', 'deprecated') then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
  update integrations.whatsapp_message_templates t
     set meta_status = p_meta_status, meta_template_id = coalesce(nullif(btrim(p_meta_template_id), ''), t.meta_template_id)
   where t.template_name = p_template_name and t.language_code = p_language_code
  returning t.id into v_id;
  if v_id is null then
    raise exception 'template_not_found' using errcode = 'P0001';
  end if;
  perform kc_private.audit_record('whatsapp_template_status_set', 'whatsapp_template', v_id,
                                  jsonb_build_object('meta_status', p_meta_status), v_actor);
end;
$$;
comment on function public.api_whatsapp_admin_set_template_status(text, text, text, text) is
  'Super admin: records a WhatsApp template''s Meta status; audited.';
grant execute on function public.api_whatsapp_admin_set_template_status(text, text, text, text) to authenticated;
