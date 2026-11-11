-- 0307_whatsapp_templates_registry | Issue #936
-- Message templates as code. supabase/functions/_shared/whatsapp/templates.json is the source of
-- truth; this migration mirrors it into whatsapp_message_templates (one row per name + language).
--
--   * template_name is no longer unique on its own: unique (template_name, language_code).
--   * New columns: params (ordered named params), registry_version, meta_status
--     (draft → submitted → approved/rejected/paused, or deprecated), meta_template_id.
--   * Seeds match_found_v1 / confirm_handoff_v1 / reminder_v1 / opt_in_confirm_v1 in he + en.
--     All stay is_approved = false until Meta approves them (see docs/agents/WHATSAPP_TEMPLATES.md).
--   * Rows not in the registry (intake_confirm_v1, opt_in_v1) are marked deprecated.
--   * api_whatsapp_queue_outbound picks the approved variant in the user's language
--     (fallback he → en); api_bot_enqueue_match_notifications passes world_label_he/en.
-- Keep the seed in sync with templates.json (enforced by templates.test.ts).

begin;

alter table public.whatsapp_message_templates
  add column if not exists params jsonb not null default '[]'::jsonb,
  add column if not exists registry_version int,
  add column if not exists meta_status text not null default 'draft'
    check (meta_status in ('draft', 'submitted', 'approved', 'rejected', 'paused', 'deprecated')),
  add column if not exists meta_template_id text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.whatsapp_message_templates
  drop constraint if exists whatsapp_message_templates_template_name_key;
alter table public.whatsapp_message_templates
  add constraint whatsapp_message_templates_name_lang_key unique (template_name, language_code);
alter table public.whatsapp_message_templates
  add constraint whatsapp_message_templates_language_check check (language_code in ('he', 'en'));

insert into public.whatsapp_message_templates
  (template_name, language_code, category, body_preview, params, registry_version)
values
  ('match_found_v1', 'he', 'utility', 'נמצאה התאמה חדשה עבורך בעולם {{1}} בקהילת קארמה. פתח/י את האפליקציה כדי לראות ולאשר. להסרה מהודעות: השב/י "הסר".', '["world_label"]'::jsonb, 1),
  ('match_found_v1', 'en', 'utility', 'We found a new match for you in {{1}} on Karma Community. Open the app to view and confirm it. Reply STOP to unsubscribe.', '["world_label"]'::jsonb, 1),
  ('confirm_handoff_v1', 'he', 'utility', 'ההתאמה שלך, {{1}}, אישרה את ההעברה של "{{2}}". אפשר לתאם איסוף או מסירה בצ''אט באפליקציה. להסרה מהודעות: השב/י "הסר".', '["partner_name","listing_title"]'::jsonb, 1),
  ('confirm_handoff_v1', 'en', 'utility', 'Your match {{1}} confirmed the handoff for "{{2}}". Coordinate pickup or delivery in the app chat. Reply STOP to unsubscribe.', '["partner_name","listing_title"]'::jsonb, 1),
  ('reminder_v1', 'he', 'utility', 'תזכורת: "{{1}}" עדיין ממתין לתשובתך בקהילת קארמה. להסרה מתזכורות: השב/י "הסר".', '["listing_title"]'::jsonb, 1),
  ('reminder_v1', 'en', 'utility', 'Reminder: "{{1}}" is still waiting for your reply on Karma Community. Reply STOP to stop reminders.', '["listing_title"]'::jsonb, 1),
  ('opt_in_confirm_v1', 'he', 'utility', 'נרשמת להתראות התאמה מקהילת קארמה ב-WhatsApp. אפשר להסיר את עצמך בכל עת: השב/י "הסר".', '[]'::jsonb, 1),
  ('opt_in_confirm_v1', 'en', 'utility', 'You''re subscribed to Karma Community match alerts on WhatsApp. Reply STOP at any time to unsubscribe.', '[]'::jsonb, 1)
on conflict (template_name, language_code) do update
  set category = excluded.category,
      params = excluded.params,
      registry_version = excluded.registry_version,
      -- a wording change invalidates a previous approval
      is_approved = case when whatsapp_message_templates.body_preview is distinct from excluded.body_preview
                         then false else whatsapp_message_templates.is_approved end,
      meta_status = case when whatsapp_message_templates.body_preview is distinct from excluded.body_preview
                         then 'draft' else whatsapp_message_templates.meta_status end,
      body_preview = excluded.body_preview,
      updated_at = now();

update public.whatsapp_message_templates
   set meta_status = 'deprecated', is_approved = false, updated_at = now()
 where template_name not in ('match_found_v1', 'confirm_handoff_v1', 'reminder_v1', 'opt_in_confirm_v1');

-- Language-aware proactive queue (same gates as 0306) --------------------------------------
create or replace function public.api_whatsapp_queue_outbound(
  p_user_id uuid,
  p_template_name text,
  p_payload jsonb,
  p_max_per_hour int default 5
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lim public.whatsapp_send_limits;
  v_identity public.whatsapp_identities;
  v_status text;
  v_hour int;
  v_day int;
  v_recipients int;
  v_id uuid;
  v_lang text;
begin
  select * into v_lim from public.whatsapp_send_limits where id;

  select * into v_identity
    from public.whatsapp_identities
   where user_id = p_user_id
   order by last_inbound_at desc nulls last, updated_at desc
   limit 1;

  if not public.whatsapp_user_can_receive(p_user_id) then
    v_status := 'skipped_no_consent';
  elsif v_identity.identity_id is null then
    v_status := 'skipped_no_identity';
  else
    -- #936: send the user's language variant when approved, else fall back he → en.
    select t.language_code into v_lang
      from public.whatsapp_message_templates t
     where t.template_name = p_template_name and t.is_approved
     order by (t.language_code = coalesce(v_identity.preferred_language, 'he')) desc,
              (t.language_code = 'he') desc
     limit 1;
  end if;

  if v_status is not null then
    null;
  elsif v_lang is null then
    v_status := 'skipped_template_unapproved';
  else
    select count(*) filter (where created_at > now() - interval '1 hour'),
           count(*)
      into v_hour, v_day
      from public.bot_outbound_messages
     where user_id = p_user_id
       and kind = 'template'
       and status in ('queued', 'sending', 'sent')
       and created_at > now() - interval '24 hours';

    select count(distinct to_wa_id) into v_recipients
      from public.bot_outbound_messages
     where kind = 'template'
       and status in ('queued', 'sending', 'sent')
       and created_at > now() - interval '24 hours'
       and to_wa_id is distinct from v_identity.wa_id;

    -- p_max_per_hour (legacy arg, default 5) can only tighten the configured cap.
    if v_hour >= greatest(least(coalesce(p_max_per_hour, v_lim.per_user_hour), v_lim.per_user_hour), 1)
       or v_day >= v_lim.per_user_day then
      v_status := 'skipped_rate_limit';
    elsif v_recipients >= v_lim.global_template_recipients_day then
      v_status := 'skipped_global_cap';
    else
      v_status := 'queued';
    end if;
  end if;

  insert into public.bot_outbound_messages (
    user_id, kind, to_wa_id, language, template_name, payload, status
  ) values (
    p_user_id, 'template', v_identity.wa_id, coalesce(v_lang, v_identity.preferred_language, 'he'),
    p_template_name, coalesce(p_payload, '{}'::jsonb), v_status
  )
  returning outbound_id into v_id;

  if v_status = 'queued' then
    perform public.whatsapp_outbound_enqueue(v_id);
  end if;
  return v_id;
end;
$$;

-- Match notifications carry localized world labels for the match_found_v1 {{1}} param ------
create or replace function public.api_bot_enqueue_match_notifications(
  p_match_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match public.listing_matches;
  v_owner_a uuid;
  v_owner_b uuid;
  v_world text;
  v_label_he text;
  v_label_en text;
  v_out_a uuid;
  v_out_b uuid;
begin
  select * into v_match from public.listing_matches where match_id = p_match_id;
  if not found then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;
  if v_match.status <> 'suggested' then
    return jsonb_build_object('skipped', true, 'reason', 'not_suggested');
  end if;

  select la.owner_id, lb.owner_id, la.world_slug
    into v_owner_a, v_owner_b, v_world
    from public.listings la, public.listings lb
   where la.listing_id = v_match.listing_id
     and lb.listing_id = v_match.candidate_listing_id;

  select w.label_he, w.label_en into v_label_he, v_label_en
    from public.worlds w where w.slug = v_world;

  v_out_a := public.api_whatsapp_queue_outbound(
    v_owner_a, 'match_found_v1',
    jsonb_build_object('match_id', p_match_id, 'world', v_world, 'role', 'a',
                       'world_label_he', coalesce(v_label_he, v_world),
                       'world_label_en', coalesce(v_label_en, v_world))
  );
  v_out_b := public.api_whatsapp_queue_outbound(
    v_owner_b, 'match_found_v1',
    jsonb_build_object('match_id', p_match_id, 'world', v_world, 'role', 'b',
                       'world_label_he', coalesce(v_label_he, v_world),
                       'world_label_en', coalesce(v_label_en, v_world))
  );

  return jsonb_build_object('owner_a_outbound', v_out_a, 'owner_b_outbound', v_out_b);
end;
$$;

revoke all on function public.api_whatsapp_queue_outbound(uuid, text, jsonb, int) from public;
grant execute on function public.api_whatsapp_queue_outbound(uuid, text, jsonb, int) to service_role;

commit;
