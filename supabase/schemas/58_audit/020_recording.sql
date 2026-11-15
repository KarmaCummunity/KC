-- Audit · writing the trail
--
-- kc_private.audit_record is the only writer of audit.events. Privileged RPCs call it in
-- their own transaction; modules created before this one enqueue an outbox event on topic
-- `audit` instead, which the consumer below turns into a row; and the triggers at the end
-- record the state changes that must never go unrecorded, whoever makes them.

-- Records one event and returns its id. The actor defaults to the signed-in caller; the
-- API role and device address are taken from the request, when there is one.
create function kc_private.audit_record(
  p_action text,
  p_target_type text default null,
  p_target_id uuid default null,
  p_metadata jsonb default '{}'::jsonb,
  p_actor_id uuid default auth.uid(),
  p_occurred_at timestamptz default now()
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_forwarded constant text := btrim(split_part(
    nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-forwarded-for', ',', 1));
  v_ip inet;
  v_id bigint;
begin
  begin
    v_ip := nullif(v_forwarded, '')::inet;
  exception when invalid_text_representation then
    v_ip := null;
  end;

  insert into audit.events (occurred_at, actor_id, actor_role, request_ip, action, target_type, target_id, metadata)
  values (
    coalesce(p_occurred_at, now()), p_actor_id,
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    v_ip, p_action, p_target_type, p_target_id, coalesce(p_metadata, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;
comment on function kc_private.audit_record(text, text, uuid, jsonb, uuid, timestamptz) is
  'The only writer of audit.events: records one action with its actor, target and id-only metadata.';

-- Consumer of outbox topic `audit`. Payload contract:
--   { "action": text, "actor_id": uuid|null, "entity": { "type": text, "id": uuid }, "data": { ids… } }
-- The row is stamped with the time the event was enqueued. A payload that cannot be
-- recorded is released with its error and retried in an hour, so it stays visible to
-- operations and never blocks the events behind it. Returns the number of rows written.
create function kc_private.audit_consume_outbox(p_limit integer default 200)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event kc_private.outbox_events;
  v_written integer := 0;
begin
  for v_event in select * from kc_private.outbox_claim('audit', p_limit) loop
    begin
      perform kc_private.audit_record(
        v_event.payload ->> 'action',
        v_event.payload #>> '{entity,type}',
        (v_event.payload #>> '{entity,id}')::uuid,
        coalesce(v_event.payload -> 'data', '{}'::jsonb),
        (v_event.payload ->> 'actor_id')::uuid,
        v_event.created_at);
      perform kc_private.outbox_complete(v_event.id);
      v_written := v_written + 1;
    exception when others then
      perform kc_private.outbox_complete(v_event.id, sqlerrm, interval '1 hour');
    end;
  end loop;
  return v_written;
end;
$$;
comment on function kc_private.audit_consume_outbox(integer) is
  'Scheduled job: writes the queued `audit` outbox events to audit.events.';

-- ── State changes recorded by trigger ───────────────────────────────────────
-- Every change of an account status: sanctions, restores, deletion requests, activation.
-- The privileged RPC that caused it records its own event with the reason; this row is the
-- state fact, written even when a future writer forgets to. The actor is the signed-in
-- caller in whose request the change happened; a move made in the machine role `system`
-- (an automatic rule or a sweep) has none. The same holds for the post trigger below.
create function kc_private.audit_user_account_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform kc_private.audit_record(
    'account_status_changed', 'user', new.user_id,
    jsonb_build_object('from', old.status, 'to', new.status, 'until', new.status_until),
    case when current_setting('kc.fsm_role', true) = 'system' then null else auth.uid() end);
  return null;
end;
$$;

create trigger user_account_audit_status
  after update of status on public.user_account
  for each row when (old.status is distinct from new.status)
  execute function kc_private.audit_user_account_status();

-- Moderation moves of a post: into or out of `hidden_pending_review` and `removed_admin`,
-- and any move made in the role `admin`. Owner moves are not audited.
create function kc_private.audit_post_moderation_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform kc_private.audit_record(
    'post_status_moderated', 'post', new.id,
    jsonb_build_object('from', old.status, 'to', new.status,
                       'role', nullif(current_setting('kc.fsm_role', true), '')),
    case when current_setting('kc.fsm_role', true) = 'system' then null else auth.uid() end);
  return null;
end;
$$;

create trigger posts_audit_moderation_status
  after update of status on public.posts
  for each row
  when (old.status is distinct from new.status
        and ('removed_admin' in (old.status, new.status)
             or 'hidden_pending_review' in (old.status, new.status)
             or current_setting('kc.fsm_role', true) = 'admin'))
  execute function kc_private.audit_post_moderation_status();
