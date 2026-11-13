-- 0184_support_chat_atomic_upsert.sql — TD-83.
--
-- find_or_create_support_chat (0033) used a read-then-insert that races under
-- concurrent callers (rpc_submit_support_issue 0074 + the report-trigger paths)
-- and can leave a duplicate support thread. The natural fix is the atomic
-- on-conflict upsert 0070 §15.3 introduced for rpc_get_or_create_support_thread.
--
-- BUT 0070's `on conflict (participant_a, participant_b)` is itself latently
-- broken: 0033 replaced the full `chats(participant_a, participant_b)` unique
-- constraint with a PARTIAL index `chats_unique_support_pair … where
-- is_support_thread = true`. Inference against a partial index requires the
-- predicate, so the bare clause raises SQLSTATE 42P10 ("no unique or exclusion
-- constraint matching the ON CONFLICT specification") at call time. This
-- migration fixes BOTH support-thread helpers by adding the index predicate to
-- the conflict target.

BEGIN;

-- (1) Internal helper — was read-then-insert (TD-83).
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
  -- Atomic upsert: the no-op DO UPDATE returns the existing row on conflict, so
  -- concurrent callers converge on the single chats_unique_support_pair row. The
  -- `where is_support_thread = true` predicate matches the partial index (0033).
  insert into public.chats (participant_a, participant_b, is_support_thread)
  values (v_a, v_b, true)
  on conflict (participant_a, participant_b) where is_support_thread = true do update
    set participant_a = excluded.participant_a
  returning chat_id into v_chat;
  return v_chat;
end;
$$;

-- (2) Public RPC — 0070 introduced the same bare on-conflict; add the predicate
-- so it infers chats_unique_support_pair instead of raising 42P10. Body is
-- otherwise verbatim from 0070; grant re-applied for stale local DBs.
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

  insert into public.chats (participant_a, participant_b, is_support_thread)
  values (v_a, v_b, true)
  on conflict (participant_a, participant_b) where is_support_thread = true do update
    set participant_a = excluded.participant_a
  returning * into v_chat;

  return v_chat;
end;
$$;

grant execute on function public.rpc_get_or_create_support_thread() to authenticated;

COMMIT;
