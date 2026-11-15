-- Audit · events (append-only trail of privileged and sensitive actions)
--
-- One row per action: who acted, what they did and on what. Rows carry ids only — never a
-- name, a phone number or a message body (design §4) — and have no foreign keys, so they
-- outlive the accounts and content they describe. Nobody updates or deletes a row, the
-- service role and the table owner included; the only way data leaves is retention, which
-- drops a whole monthly partition (FR-MOD-012 AC3).
--
-- Partitioned by month with plain declarative partitions (no pg_partman): a scheduled job
-- calls kc_private.audit_ensure_partition ahead of time; the default partition catches a row
-- whose month was never prepared, so a missed job can never fail a member's write.

create sequence audit.events_id_seq;

create table audit.events (
  id          bigint not null default nextval('audit.events_id_seq'),
  occurred_at timestamptz not null default now(),
  -- The member who acted; null for sweeps, triggers of automatic rules and the service role.
  actor_id    uuid,
  -- Request context: the API role of the caller and the device address, when there is one.
  actor_role  text,
  request_ip  inet,
  -- Stable snake_case verb, e.g. 'ban_user', 'restore_target', 'account_status_changed'.
  action      text not null check (action ~ '^[a-z][a-z0-9_]{2,62}$'),
  target_type text check (target_type ~ '^[a-z][a-z0-9_]{1,30}$'),
  target_id   uuid,
  -- Ids, statuses and reason codes only. The key check is a tripwire for the commonest
  -- ways personal text could slip in; free text belongs in the module's own table.
  metadata    jsonb not null default '{}'::jsonb
                check (jsonb_typeof(metadata) = 'object'
                       and not metadata ?| array['name', 'display_name', 'phone', 'email', 'address',
                                                 'body', 'note', 'text', 'comment']),
  primary key (occurred_at, id),
  constraint events_target_pair_chk check (target_id is null or target_type is not null)
) partition by range (occurred_at);
comment on table audit.events is 'Append-only audit trail, one partition per month. Ids only; no updates, no deletes.';
alter sequence audit.events_id_seq owned by audit.events.id;

-- Admin screen "history of a member / a post": events about one target, newest first.
create index events_target_recent_idx on audit.events (target_id, occurred_at desc, id desc)
  where target_id is not null;
-- Admin screen "what did this staff member do": events by one actor, newest first.
create index events_actor_recent_idx on audit.events (actor_id, occurred_at desc, id desc)
  where actor_id is not null;
-- Admin screen filter by action, newest first.
create index events_action_recent_idx on audit.events (action, occurred_at desc, id desc);

alter table audit.events enable row level security;
alter table audit.events force row level security;

-- Refuses every change to audit data. Attached per row (UPDATE, DELETE) and per statement
-- (TRUNCATE); it has no exception for any role.
create function kc_private.audit_reject_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'append_only' using errcode = 'P0001',
    detail = format('%s on %s.%s', tg_op, tg_table_schema, tg_table_name);
end;
$$;
comment on function kc_private.audit_reject_change() is
  'Trigger: raises append_only on UPDATE, DELETE and TRUNCATE of audit data, for every role.';

-- Row triggers on the partitioned table are inherited by every partition, present and future.
create trigger events_append_only
  before update or delete on audit.events
  for each row execute function kc_private.audit_reject_change();
create trigger events_no_truncate
  before truncate on audit.events
  for each statement execute function kc_private.audit_reject_change();

-- The service role reads the trail and writes it only through kc_private.audit_record.
revoke all on audit.events from service_role;
grant select on audit.events to service_role;

-- Applies to one partition what the parent cannot pass down: forced RLS, no direct
-- privileges for the service role, and the TRUNCATE guard (statement triggers are not inherited).
create function kc_private.audit_secure_partition(p_partition text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  execute format('alter table audit.%I enable row level security', p_partition);
  execute format('alter table audit.%I force row level security', p_partition);
  execute format('revoke all on audit.%I from service_role', p_partition);
  execute format(
    'create trigger %I before truncate on audit.%I for each statement '
    'execute function kc_private.audit_reject_change()', p_partition || '_no_truncate', p_partition);
end;
$$;

create table audit.events_default partition of audit.events default;
comment on table audit.events_default is 'Safety net for a month whose partition was not created in time.';
do $$ begin perform kc_private.audit_secure_partition('events_default'); end $$;

-- Creates the partition of the month containing p_month (UTC) unless it exists. Returns
-- whether it was created. Run monthly, a month ahead, by the scheduler; definer rights
-- because the service role may not create objects in `audit`. If the default partition
-- already holds rows of that month the server refuses the new partition; those rows stay
-- readable where they are, and the month keeps using the default partition.
create function kc_private.audit_ensure_partition(p_month date)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from constant timestamptz := date_trunc('month', p_month)::timestamp at time zone 'UTC';
  v_to constant timestamptz := (date_trunc('month', p_month) + interval '1 month')::timestamp at time zone 'UTC';
  v_name constant text := 'events_' || to_char(p_month, '"y"YYYY"m"MM');
begin
  if to_regclass(format('audit.%I', v_name)) is not null then
    return false;
  end if;
  begin
    execute format('create table audit.%I partition of audit.events for values from (%L) to (%L)',
                   v_name, v_from, v_to);
  exception when check_violation then
    return false;
  end;
  perform kc_private.audit_secure_partition(v_name);
  return true;
end;
$$;
comment on function kc_private.audit_ensure_partition(date) is
  'Creates the monthly partition of audit.events for the given date; idempotent.';

-- Retention, the one way audit data is ever removed: drops every monthly partition that
-- ends at or before the month of p_cutoff. The trail is kept for at least 24 months
-- (FR-MOD-012 AC3), so a more recent cutoff is refused.
create function kc_private.audit_drop_partitions_before(p_cutoff date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_partition text;
  v_dropped integer := 0;
begin
  if p_cutoff > (current_date - interval '24 months')::date then
    raise exception 'retention_too_short' using errcode = 'P0001', detail = 'audit rows are kept 24 months';
  end if;
  for v_partition in
    select c.relname
      from pg_catalog.pg_inherits i
      join pg_catalog.pg_class c on c.oid = i.inhrelid
     where i.inhparent = 'audit.events'::regclass
       and c.relname ~ '^events_y[0-9]{4}m[0-9]{2}$'
       and to_date(c.relname, '"events_y"YYYY"m"MM') + interval '1 month' <= date_trunc('month', p_cutoff)
  loop
    execute format('drop table audit.%I', v_partition);
    v_dropped := v_dropped + 1;
  end loop;
  return v_dropped;
end;
$$;
comment on function kc_private.audit_drop_partitions_before(date) is
  'Retention: drops whole monthly partitions older than the cutoff (never younger than 24 months).';

-- Partitions for the month the database is created in and the one after it.
do $$
begin
  perform kc_private.audit_ensure_partition(current_date);
  perform kc_private.audit_ensure_partition((current_date + interval '1 month')::date);
end $$;
