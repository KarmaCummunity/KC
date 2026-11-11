-- 0013_reports_emit_admin_message | P0.5 — admin notification on report submit.
-- FR-CHAT-007 AC3 / FR-CHAT-010 AC2 / FR-MOD-002.
--
-- After a report row is inserted, find-or-create the support thread between
-- the reporter and the super admin and insert a `system` message summarizing
-- the report. The admin sees the report instantly in their inbox; no client
-- code is required to wire this — the trigger is authoritative.
--
-- system_payload carries the structured fields (target, reason, note,
-- report_id) so a future admin UI can render a rich card. body carries a
-- legacy-friendly Hebrew summary so any client that doesn't decode the
-- payload still shows useful text.

create or replace function public.reports_emit_admin_system_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
  v_chat_id  uuid;
  v_a        uuid;
  v_b        uuid;
  v_payload  jsonb;
  v_body     text;
begin
  select user_id into v_admin_id
  from public.users
  where is_super_admin = true
  limit 1;

  -- No admin → skip the system message; the report row itself is preserved.
  if v_admin_id is null then return new; end if;

  -- Admin reporting (e.g. self-test) — don't open a thread with themselves.
  if v_admin_id = new.reporter_id then return new; end if;

  -- Canonical pair ordering (matches chats_canonicalize_participants).
  if new.reporter_id < v_admin_id then
    v_a := new.reporter_id; v_b := v_admin_id;
  else
    v_a := v_admin_id; v_b := new.reporter_id;
  end if;

  -- Find-or-create the support thread.
  select chat_id into v_chat_id
  from public.chats
  where participant_a = v_a and participant_b = v_b;

  if v_chat_id is null then
    insert into public.chats (participant_a, participant_b, is_support_thread)
    values (v_a, v_b, true)
    returning chat_id into v_chat_id;
  end if;

  v_payload := jsonb_build_object(
    'kind',        'report',
    'report_id',   new.report_id,
    'target_type', new.target_type,
    'target_id',   new.target_id,
    'reason',      new.reason,
    'note',        new.note,
    'created_at',  new.created_at
  );

  v_body := 'דיווח חדש: ' || new.reason;
  if new.target_type <> 'none' then
    v_body := v_body || ' · יעד: ' || new.target_type;
  end if;
  if new.note is not null then
    v_body := v_body || E'\n' || new.note;
  end if;

  -- Insert system message. sender_id is null (system); status='delivered'
  -- with delivered_at=now() because there is no recipient-driven flip path.
  insert into public.messages (chat_id, sender_id, kind, body, system_payload, status, delivered_at)
  values (v_chat_id, null, 'system', v_body, v_payload, 'delivered', now());

  return new;
end;
$$;

drop trigger if exists reports_after_insert_emit_message on public.reports;
create trigger reports_after_insert_emit_message
  after insert on public.reports
  for each row execute function public.reports_emit_admin_system_message();
