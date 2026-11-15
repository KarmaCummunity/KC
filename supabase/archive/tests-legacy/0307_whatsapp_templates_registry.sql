-- supabase/tests/0307_whatsapp_templates_registry.sql | Issue #936

begin;

create or replace function pg_temp.mk_user(p_id uuid, p_handle text)
returns void language plpgsql as $$
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, aud, role)
  values (p_id, p_handle || '@test.local', now(),
          jsonb_build_object('full_name', 'Display ' || p_handle),
          jsonb_build_object('provider', 'email'),
          'authenticated', 'authenticated');
  update public.users
     set share_handle = p_handle, display_name = 'Display ' || p_handle,
         account_status = 'active', privacy_mode = 'Public'
   where user_id = p_id;
end $$;

-- 1) Registry rows: every template in he + en, params recorded, legacy rows deprecated.
do $$
declare
  v_name text;
  v_n int;
begin
  foreach v_name in array array['match_found_v1', 'confirm_handoff_v1', 'reminder_v1', 'opt_in_confirm_v1'] loop
    select count(*) into v_n from public.whatsapp_message_templates
     where template_name = v_name and language_code in ('he', 'en') and meta_status <> 'deprecated';
    if v_n <> 2 then raise exception 'ASSERT FAILED: % should have he + en rows, got %', v_name, v_n; end if;
  end loop;

  if (select params from public.whatsapp_message_templates
       where template_name = 'confirm_handoff_v1' and language_code = 'en')
     <> '["partner_name", "listing_title"]'::jsonb then
    raise exception 'ASSERT FAILED: confirm_handoff_v1 params';
  end if;
  if exists (select 1 from public.whatsapp_message_templates
              where template_name in ('intake_confirm_v1', 'opt_in_v1')
                and (meta_status <> 'deprecated' or is_approved)) then
    raise exception 'ASSERT FAILED: legacy templates must be deprecated + unapproved';
  end if;
  if exists (select 1 from public.whatsapp_message_templates
              where meta_status <> 'deprecated' and body_preview not like '%{{%' and params <> '[]'::jsonb) then
    raise exception 'ASSERT FAILED: templates with params must have placeholders';
  end if;

  begin
    insert into public.whatsapp_message_templates (template_name, language_code, category, body_preview)
    values ('reminder_v1', 'en', 'utility', 'dup');
    raise exception 'ASSERT FAILED: duplicate (name, language) must be rejected';
  exception when unique_violation then null;
  end;
end $$;

-- 2) Language selection: preferred approved variant, else he fallback, else skipped.
do $$
declare
  v_user uuid := '00000000-0000-0000-0000-000000307001';
  v_out uuid;
  r public.bot_outbound_messages;
begin
  perform pg_temp.mk_user(v_user, 'wa_tpl_en');
  perform public.api_bot_link_identity('972500307001', v_user);
  perform public.api_bot_set_match_consent(v_user, true);
  update public.whatsapp_identities set preferred_language = 'en' where wa_id = '972500307001';
  update public.whatsapp_message_templates set is_approved = false where template_name = 'reminder_v1';

  v_out := public.api_whatsapp_queue_outbound(v_user, 'reminder_v1', '{"listing_title":"Sofa"}'::jsonb);
  select * into r from public.bot_outbound_messages where outbound_id = v_out;
  if r.status <> 'skipped_template_unapproved' then
    raise exception 'ASSERT FAILED: nothing approved → skipped, got %', r.status;
  end if;

  update public.whatsapp_message_templates set is_approved = true
   where template_name = 'reminder_v1' and language_code = 'he';
  v_out := public.api_whatsapp_queue_outbound(v_user, 'reminder_v1', '{"listing_title":"Sofa"}'::jsonb);
  select * into r from public.bot_outbound_messages where outbound_id = v_out;
  if r.status <> 'queued' or r.language <> 'he' then
    raise exception 'ASSERT FAILED: he fallback, got % / %', r.status, r.language;
  end if;

  update public.whatsapp_message_templates set is_approved = true
   where template_name = 'reminder_v1' and language_code = 'en';
  v_out := public.api_whatsapp_queue_outbound(v_user, 'reminder_v1', '{"listing_title":"Sofa"}'::jsonb);
  select * into r from public.bot_outbound_messages where outbound_id = v_out;
  if r.status <> 'queued' or r.language <> 'en' then
    raise exception 'ASSERT FAILED: preferred en variant, got % / %', r.status, r.language;
  end if;
end $$;

rollback;

\echo '✓ 0307_whatsapp_templates_registry.sql passed'
