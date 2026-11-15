-- 0033_chat_inbox_personal_hide | FR-CHAT-016 — personal inbox hide (per viewer)
-- Design: docs/superpowers/specs/2026-05-11-chat-personal-delete-design.md

-- ── 1. Columns (per canonical participant_a < participant_b) ────────────────
alter table public.chats
  add column if not exists inbox_hidden_at_a timestamptz,
  add column if not exists inbox_hidden_at_b timestamptz;

comment on column public.chats.inbox_hidden_at_a is
  'When set, participant_a hides this chat from their inbox (FR-CHAT-016).';
comment on column public.chats.inbox_hidden_at_b is
  'When set, participant_b hides this chat from their inbox (FR-CHAT-016).';

-- ── 2. Allow multiple DM rows per ordered pair; keep support singleton ─────
alter table public.chats drop constraint if exists chats_participant_a_participant_b_key;

create unique index if not exists chats_unique_support_pair
  on public.chats (participant_a, participant_b)
  where is_support_thread = true;

-- ── 3. Clear hide flags on any new message (user or system) ─────────────────
create or replace function public.chats_clear_inbox_hide_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chats
  set inbox_hidden_at_a = null,
      inbox_hidden_at_b = null
  where chat_id = new.chat_id;
  return new;
end;
$$;

drop trigger if exists messages_after_insert_clear_inbox_hide on public.messages;
create trigger messages_after_insert_clear_inbox_hide
  after insert on public.messages
  for each row execute function public.chats_clear_inbox_hide_on_message();

-- ── 4. RPC — hide for current viewer (no client UPDATE on chats) ────────────
create or replace function public.rpc_chat_hide_for_viewer(p_chat_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  r public.chats%rowtype;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into r from public.chats where chat_id = p_chat_id;
  if not found then
    raise exception 'chat_not_found' using errcode = 'P0002';
  end if;

  if r.is_support_thread then
    raise exception 'support_thread_not_hideable' using errcode = 'P0001';
  end if;

  if v_uid is distinct from r.participant_a and v_uid is distinct from r.participant_b then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_uid = r.participant_a then
    update public.chats set inbox_hidden_at_a = now() where chat_id = p_chat_id;
  else
    update public.chats set inbox_hidden_at_b = now() where chat_id = p_chat_id;
  end if;
end;
$$;

revoke all on function public.rpc_chat_hide_for_viewer(uuid) from public;
grant execute on function public.rpc_chat_hide_for_viewer(uuid) to authenticated;

-- ── 5. Unread total — exclude viewer-hidden chats ───────────────────────────
create or replace function public.rpc_chat_unread_total()
returns bigint
language sql
security invoker
stable
set search_path = public
as $$
  select count(*)::bigint
  from public.messages m
  join public.chats c on c.chat_id = m.chat_id
  where (auth.uid() = c.participant_a or auth.uid() = c.participant_b)
    and m.sender_id is distinct from auth.uid()
    and m.status <> 'read'
    and public.is_chat_visible_to(c, auth.uid())
    and (
      case
        when auth.uid() = c.participant_a then c.inbox_hidden_at_a is null
        when auth.uid() = c.participant_b then c.inbox_hidden_at_b is null
        else false
      end
    );
$$;

-- ── 6. Support thread lookup — disambiguate when duplicate pair rows exist ───
create or replace function public.rpc_get_or_create_support_thread()
returns public.chats
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
  v_viewer   uuid := auth.uid();
  v_a        uuid;
  v_b        uuid;
  v_chat     public.chats;
begin
  if v_viewer is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select user_id into v_admin_id
  from public.users
  where is_super_admin = true
  limit 1;

  if v_admin_id is null then
    raise exception 'super_admin_not_found' using errcode = 'P0001';
  end if;

  if v_admin_id = v_viewer then
    raise exception 'super_admin_self_thread_forbidden' using errcode = 'P0001';
  end if;

  if v_viewer < v_admin_id then v_a := v_viewer; v_b := v_admin_id;
  else v_a := v_admin_id; v_b := v_viewer; end if;

  select * into v_chat
  from public.chats
  where participant_a = v_a
    and participant_b = v_b
    and is_support_thread = true;

  if found then return v_chat; end if;

  insert into public.chats (participant_a, participant_b, is_support_thread)
  values (v_a, v_b, true)
  returning * into v_chat;

  return v_chat;
end;
$$;

-- ── 7. Disambiguate support thread in trigger helpers (same pair, multiple rows) ─
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

  if v_admin_id is null then return new; end if;
  if v_admin_id = new.reporter_id then return new; end if;

  if new.reporter_id < v_admin_id then
    v_a := new.reporter_id; v_b := v_admin_id;
  else
    v_a := v_admin_id; v_b := new.reporter_id;
  end if;

  select chat_id into v_chat_id
  from public.chats
  where participant_a = v_a and participant_b = v_b and is_support_thread = true;

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

  insert into public.messages (chat_id, sender_id, kind, body, system_payload, status, delivered_at)
  values (v_chat_id, null, 'system', v_body, v_payload, 'delivered', now());

  return new;
end;
$$;

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
    return null;
  end if;
  if v_admin = p_user then
    return null;
  end if;
  if p_user < v_admin then v_a := p_user; v_b := v_admin;
                      else v_a := v_admin; v_b := p_user; end if;
  select chat_id into v_chat
  from public.chats
  where participant_a = v_a and participant_b = v_b and is_support_thread = true;
  if v_chat is null then
    insert into public.chats (participant_a, participant_b, is_support_thread)
    values (v_a, v_b, true)
    returning chat_id into v_chat;
  end if;
  return v_chat;
end;
$$;
