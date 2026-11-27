-- Platform · durable deletion intents for storage, with a verified re-sweep (FR-SETTINGS-012 AC4;
-- supabase/proposals/post-media-privacy-lifecycle/DESIGN.md §4, phase 1: account purge)
--
-- The account purge empties a member's folders and then deletes the identity; every row of the
-- member cascades, including the photo jobs that recorded what a worker might still be writing. A
-- write that commits after the folders were emptied (an upload a device aborted, a worker upload
-- Storage committed late) was then left behind with no record that it should not exist.
--
-- This adds a record that survives the cascade and a re-sweep that acts on it:
--
--   1. `account_purge_finish` writes one intent per folder of the member (`<user_id>` in every
--      bucket, `derived/<user_id>` in post-images) in the same transaction that deletes the
--      identity. The table has no foreign key to anything, so no cascade removes an intent.
--   2. The purge worker takes due intents (`storage_deletion_intents_due`), lists each folder,
--      deletes what it finds, lists again, and reports (`storage_deletion_intent_swept`).
--   3. An intent is closed only when the second listing was empty AND its quiet window
--      (`not_before`: the deletion time plus the longest a worker lease and an upload can last,
--      with margin) has passed. Before that, or when something was still there, it stays open and
--      is swept again later; an error backs off. An intent swept many times without closing is
--      reported in ops.warnings.
--
-- What "closed" means, stated plainly: the folder was empty at a sweep after the quiet window. A
-- finite window cannot prove that no write will still commit (no commit-time refusal exists for
-- service writes, DESIGN.md §4), so this is eventual deletion, re-checked, not a storage fence.
-- Closed intents keep the path (it holds the user id) for 7 days, then they are deleted.

create table kc_private.storage_deletion_intents (
  id                 bigint generated always as identity primary key,
  bucket             text not null check (bucket ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  -- A folder, without a trailing slash: `<user_id>` or `derived/<user_id>`.
  prefix             text not null check (prefix ~ '^[A-Za-z0-9][A-Za-z0-9/_-]{0,200}$' and prefix !~ '(^|/)\.\.(/|$)'),
  reason             text not null check (reason in ('account_purge')),
  created_at         timestamptz not null default now(),
  -- No sweep may close the intent before this: writes that started before the deletion may still land.
  not_before         timestamptz not null,
  next_sweep_at      timestamptz not null default now(),
  sweeps             integer not null default 0 check (sweeps >= 0),
  -- Objects the last sweep found (and deleted), and how many its second listing still saw.
  last_found         integer check (last_found >= 0),
  last_remaining     integer check (last_remaining >= 0),
  last_error         text check (char_length(last_error) <= 500),
  verified_absent_at timestamptz,
  constraint storage_deletion_intents_window_chk check (not_before >= created_at)
);
comment on table kc_private.storage_deletion_intents is
  'Storage folders that must end up empty (account purge); no foreign key, so no cascade removes a row.';

-- The sweep scans open intents that are due.
create index storage_deletion_intents_due_idx on kc_private.storage_deletion_intents (next_sweep_at)
  where verified_absent_at is null;

alter table kc_private.storage_deletion_intents enable row level security;
alter table kc_private.storage_deletion_intents force row level security;

-- The quiet window after a deletion: a photo job lease (at most 15 min, post_media_processing_claim),
-- an upload's own deadline, and margin. Not a proof of quiescence (see the header).
create function kc_private.storage_deletion_quiet_window()
returns interval
language sql
immutable
set search_path = ''
as $$
  select interval '1 hour';
$$;

-- An intent swept this many times without closing is reported (ops.warnings), and keeps being swept.
create function kc_private.storage_deletion_alert_after()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 5;
$$;

-- Step 3 of the purge contract now also records what must end up empty, in the same transaction.
create or replace function kc_private.account_purge_finish(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from auth.users au where au.id = p_user_id) then
    return false;
  end if;
  perform kc_private.account_purge_require_due(p_user_id);
  insert into kc_private.storage_deletion_intents (bucket, prefix, reason, not_before)
  select f.bucket, f.prefix, 'account_purge', now() + kc_private.storage_deletion_quiet_window()
    from (select b.id as bucket, p_user_id::text as prefix from storage.buckets b
          union all
          select 'post-images', 'derived/' || p_user_id::text
           where exists (select 1 from storage.buckets b where b.id = 'post-images')) f;
  delete from auth.users au where au.id = p_user_id;
  return true;
end;
$$;

-- Due open intents, oldest first, for one sweep.
create function kc_private.storage_deletion_intents_due(p_limit integer default 50)
returns table (id bigint, bucket text, prefix text)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.bucket, i.prefix
    from kc_private.storage_deletion_intents i
   where i.verified_absent_at is null and i.next_sweep_at <= now()
   order by i.next_sweep_at, i.id
   limit least(greatest(coalesce(p_limit, 50), 1), 500);
$$;

-- Records one sweep of an intent. Answers:
--   verified  the second listing was empty after the quiet window: the intent is closed
--   pending   swept, but the window has not passed or something was still there: swept again later
--   retry     the sweep failed (p_error): swept again after a back-off
--   unknown   no open intent with that id
create function kc_private.storage_deletion_intent_swept(
  p_id bigint, p_found integer, p_remaining integer, p_error text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent kc_private.storage_deletion_intents;
  v_backoff interval;
begin
  select * into v_intent from kc_private.storage_deletion_intents i
   where i.id = p_id and i.verified_absent_at is null for update;
  if not found then
    return 'unknown';
  end if;
  -- 15 min, 30 min, 1 h, … capped at a day.
  v_backoff := least(interval '15 minutes' * power(2, least(v_intent.sweeps, 7)), interval '1 day');

  if p_error is not null then
    update kc_private.storage_deletion_intents
       set sweeps = sweeps + 1, last_error = left(p_error, 500), next_sweep_at = now() + v_backoff
     where id = p_id;
  elsif p_remaining = 0 and now() >= v_intent.not_before then
    update kc_private.storage_deletion_intents
       set sweeps = sweeps + 1, last_found = greatest(p_found, 0), last_remaining = 0, last_error = null,
           verified_absent_at = now()
     where id = p_id;
    return 'verified';
  else
    update kc_private.storage_deletion_intents
       set sweeps = sweeps + 1, last_found = greatest(p_found, 0), last_remaining = greatest(p_remaining, 0),
           last_error = null, next_sweep_at = greatest(v_intent.not_before, now() + v_backoff)
     where id = p_id;
  end if;

  if v_intent.sweeps + 1 >= kc_private.storage_deletion_alert_after() then
    perform kc_private.ops_warn('storage_deletion_stuck',
      'a storage deletion intent is still open after ' || (v_intent.sweeps + 1) || ' sweeps');
  end if;
  return case when p_error is not null then 'retry' else 'pending' end;
end;
$$;

-- Closed intents keep their path (it holds a user id) for 7 days. Returns the rows deleted.
create function kc_private.storage_deletion_intents_prune()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from kc_private.storage_deletion_intents i
   where i.verified_absent_at < now() - interval '7 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- Only the purge worker (over its database connection) calls these.
revoke all on function kc_private.storage_deletion_intents_due(integer) from public, anon, authenticated;
revoke all on function kc_private.storage_deletion_intent_swept(bigint, integer, integer, text) from public, anon, authenticated;
revoke all on function kc_private.storage_deletion_intents_prune() from public, anon, authenticated;
