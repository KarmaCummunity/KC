-- 0044_personal_activity_log | FR-STATS-003 — durable timeline + reopen / unmark events
--
-- Replaces best-effort rpc (0030) with append-only log + triggers. rpc reads log only.
-- Backfill preserves historical rows derived from current post/recipient state (0030 logic).

set search_path = public;

-- ── 1. Log table ───────────────────────────────────────────────────────────
create table if not exists public.user_personal_activity_log (
  log_id                bigserial primary key,
  subject_user_id       uuid not null references public.users (user_id) on delete cascade,
  occurred_at           timestamptz not null,
  kind                  text not null
    check (kind in (
      'post_created',
      'post_closed_delivered',
      'post_closed_no_recipient',
      'post_reopened',
      'marked_as_recipient',
      'unmarked_as_recipient',
      'post_expired',
      'post_removed_admin'
    )),
  post_id               uuid not null,
  post_title            text not null,
  actor_display_name    text null
);

create index if not exists user_personal_activity_log_subject_occurred_idx
  on public.user_personal_activity_log (subject_user_id, occurred_at desc, log_id desc);

alter table public.user_personal_activity_log enable row level security;

create policy user_personal_activity_log_select_own
  on public.user_personal_activity_log
  for select
  to authenticated
  using (subject_user_id = auth.uid());

-- No insert/update/delete for clients — writers are SECURITY DEFINER triggers only.
revoke insert, update, delete on public.user_personal_activity_log from authenticated, anon;
grant select on public.user_personal_activity_log to authenticated;

-- ── 2. Backfill (0030 merged semantics) before live triggers ────────────────
insert into public.user_personal_activity_log (
  subject_user_id, occurred_at, kind, post_id, post_title, actor_display_name
)
with owned as (
  select p.post_id, p.owner_id, p.title, p.status, p.created_at, p.updated_at
  from public.posts p
),
created_events as (
  select o.owner_id as subject_user_id,
         o.created_at as occurred_at,
         'post_created'::text as kind,
         o.post_id,
         o.title as post_title,
         null::text as actor_display_name
  from owned o
),
closure_events as (
  select o.owner_id as subject_user_id,
         o.updated_at as occurred_at,
         case o.status
           when 'closed_delivered' then 'post_closed_delivered'
           when 'deleted_no_recipient' then 'post_closed_no_recipient'
           when 'expired' then 'post_expired'
           when 'removed_admin' then 'post_removed_admin'
           else null
         end as kind,
         o.post_id,
         o.title as post_title,
         null::text as actor_display_name
  from owned o
  where o.status <> 'open'
),
marked as (
  select r.recipient_user_id as subject_user_id,
         r.marked_at as occurred_at,
         'marked_as_recipient'::text as kind,
         r.post_id,
         p.title as post_title,
         u.display_name as actor_display_name
  from public.recipients r
  join public.posts p on p.post_id = r.post_id
  join public.users u on u.user_id = p.owner_id
),
merged as (
  select * from created_events
  union all
  select ce.* from closure_events ce where ce.kind is not null
  union all
  select * from marked
)
select m.subject_user_id, m.occurred_at, m.kind, m.post_id, m.post_title, m.actor_display_name
  from merged m;

-- ── 3. posts triggers ───────────────────────────────────────────────────────
create or replace function public.posts_personal_activity_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_personal_activity_log (
    subject_user_id, occurred_at, kind, post_id, post_title, actor_display_name
  ) values (
    new.owner_id,
    new.created_at,
    'post_created',
    new.post_id,
    new.title,
    null
  );
  return new;
end;
$$;

create or replace function public.posts_personal_activity_after_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'open' and old.status in ('closed_delivered', 'deleted_no_recipient') then
    insert into public.user_personal_activity_log (
      subject_user_id, occurred_at, kind, post_id, post_title, actor_display_name
    ) values (
      new.owner_id,
      new.updated_at,
      'post_reopened',
      new.post_id,
      new.title,
      null
    );
  elsif old.status = 'open' and new.status = 'closed_delivered' then
    insert into public.user_personal_activity_log (
      subject_user_id, occurred_at, kind, post_id, post_title, actor_display_name
    ) values (
      new.owner_id,
      new.updated_at,
      'post_closed_delivered',
      new.post_id,
      new.title,
      null
    );
  elsif old.status = 'open' and new.status = 'deleted_no_recipient' then
    insert into public.user_personal_activity_log (
      subject_user_id, occurred_at, kind, post_id, post_title, actor_display_name
    ) values (
      new.owner_id,
      new.updated_at,
      'post_closed_no_recipient',
      new.post_id,
      new.title,
      null
    );
  elsif new.status = 'expired' and old.status is distinct from new.status then
    insert into public.user_personal_activity_log (
      subject_user_id, occurred_at, kind, post_id, post_title, actor_display_name
    ) values (
      new.owner_id,
      new.updated_at,
      'post_expired',
      new.post_id,
      new.title,
      null
    );
  elsif new.status = 'removed_admin' and old.status is distinct from new.status then
    insert into public.user_personal_activity_log (
      subject_user_id, occurred_at, kind, post_id, post_title, actor_display_name
    ) values (
      new.owner_id,
      new.updated_at,
      'post_removed_admin',
      new.post_id,
      new.title,
      null
    );
  end if;
  return new;
end;
$$;

drop trigger if exists posts_personal_activity_after_insert on public.posts;
create trigger posts_personal_activity_after_insert
  after insert on public.posts
  for each row execute function public.posts_personal_activity_after_insert();

drop trigger if exists posts_personal_activity_after_status on public.posts;
create trigger posts_personal_activity_after_status
  after update of status on public.posts
  for each row
  when (old.status is distinct from new.status)
  execute function public.posts_personal_activity_after_status_change();

-- ── 4. recipients triggers ───────────────────────────────────────────────────
create or replace function public.recipients_personal_activity_after_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title         text;
  v_owner_name    text;
  v_occurred      timestamptz;
begin
  if tg_op = 'INSERT' then
    select p.title, u.display_name
      into v_title, v_owner_name
      from public.posts p
      join public.users u on u.user_id = p.owner_id
     where p.post_id = new.post_id;
    insert into public.user_personal_activity_log (
      subject_user_id, occurred_at, kind, post_id, post_title, actor_display_name
    ) values (
      new.recipient_user_id,
      new.marked_at,
      'marked_as_recipient',
      new.post_id,
      coalesce(v_title, ''),
      v_owner_name
    );
    return new;
  end if;
  if tg_op = 'DELETE' then
    select p.title into v_title
      from public.posts p
     where p.post_id = old.post_id;
    v_occurred := statement_timestamp();
    insert into public.user_personal_activity_log (
      subject_user_id, occurred_at, kind, post_id, post_title, actor_display_name
    ) values (
      old.recipient_user_id,
      v_occurred,
      'unmarked_as_recipient',
      old.post_id,
      coalesce(v_title, ''),
      null
    );
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists recipients_personal_activity_after_ins on public.recipients;
create trigger recipients_personal_activity_after_ins
  after insert on public.recipients
  for each row execute function public.recipients_personal_activity_after_row();

drop trigger if exists recipients_personal_activity_after_del on public.recipients;
create trigger recipients_personal_activity_after_del
  after delete on public.recipients
  for each row execute function public.recipients_personal_activity_after_row();

-- ── 5. RPC reads log only ─────────────────────────────────────────────────────
create or replace function public.rpc_my_activity_timeline(p_limit int default 30)
returns table (
  occurred_at timestamptz,
  kind text,
  post_id uuid,
  post_title text,
  actor_display_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_lim int;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  v_lim := greatest(1, least(coalesce(p_limit, 30), 50));

  return query
  select l.occurred_at, l.kind, l.post_id, l.post_title, l.actor_display_name
    from public.user_personal_activity_log l
   where l.subject_user_id = v_uid
   order by l.occurred_at desc, l.log_id desc
   limit v_lim;
end;
$$;

revoke all on function public.rpc_my_activity_timeline(int) from public;
grant execute on function public.rpc_my_activity_timeline(int) to authenticated;

-- end 0044_personal_activity_log
