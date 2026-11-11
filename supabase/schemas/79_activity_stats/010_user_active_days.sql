-- Activity · active days (FR-SETTINGS-016 AC10)
--
-- One row per member per Israel calendar day on which they opened the app signed in. It
-- feeds survey prompt eligibility ("active on 2 of the last 14 days") and retention
-- reports; nothing reads it from a device, so it lives outside the API schema.
--
-- Recording is its own call, not part of bootstrap_session(): the app marks the day on
-- every return to the foreground, long after the session started, and bootstrap_session
-- stays a read-only (STABLE) function that is safe to retry and to serve from a replica.

create table kc_private.user_active_days (
  user_id   uuid not null references public.users (id) on delete cascade,
  active_on date not null,
  -- Also the range read "days of a member in the last 14".
  primary key (user_id, active_on)
);
comment on table kc_private.user_active_days is
  'Israel calendar days on which a member opened the app while signed in.';

-- Retention job: rows older than the retention window.
create index user_active_days_day_idx on kc_private.user_active_days (active_on);

alter table kc_private.user_active_days enable row level security;
alter table kc_private.user_active_days force row level security;

-- Marks the caller active today. Called on app open and on every return to the
-- foreground; repeating it within the day writes nothing.
create function public.record_active_day()
returns void
language sql
security definer
set search_path = ''
as $$
  insert into kc_private.user_active_days (user_id, active_on)
  select u.id, (now() at time zone 'Asia/Jerusalem')::date
    from public.users u
   where u.id = kc_private.require_caller()
  on conflict do nothing;
$$;
comment on function public.record_active_day() is 'Marks the caller active on the current Israel calendar day.';
grant execute on function public.record_active_day() to authenticated;

-- Distinct active days of a member in the 14 days ending today (Israel time).
create function kc_private.user_active_days_14d(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
    from kc_private.user_active_days d
   where d.user_id = p_user_id
     and d.active_on > (now() at time zone 'Asia/Jerusalem')::date - 14;
$$;
comment on function kc_private.user_active_days_14d(uuid) is
  'Number of days a member was active in the last 14 Israel calendar days.';

-- Deletes rows older than 400 days; returns how many. Run by a scheduled job.
create function kc_private.user_active_days_purge()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from kc_private.user_active_days d
   where d.active_on < (now() at time zone 'Asia/Jerusalem')::date - 400;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
comment on function kc_private.user_active_days_purge() is 'Retention of active days: removes rows older than 400 days.';
