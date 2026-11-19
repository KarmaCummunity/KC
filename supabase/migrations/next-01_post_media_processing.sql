-- KC#2316: process all pending photos, including the existing backlog. No status is
-- inferred from a client claim or from storage metadata: the worker must decode,
-- re-encode (strip EXIF), and upload the original and thumbnail before completion.
create table kc_private.post_media_work (
  media_id uuid primary key references public.post_media(id) on delete cascade,
  attempts integer not null default 0,
  retry_at timestamptz not null default now()
);
alter table kc_private.post_media_work enable row level security;
alter table kc_private.post_media_work force row level security;

-- A five-minute lease keeps overlapping invocations off the same objects. Failed
-- work is retried twice; the third failure becomes a terminal FSM failure.
create function kc_private.claim_post_media()
returns table (id uuid, storage_key text, mime_type text, attempts integer)
language plpgsql security definer set search_path = '' as $$
begin
  insert into kc_private.post_media_work(media_id)
    select m.id from public.post_media m
     where m.processing_status = 'pending' and m.kind = 'image' and m.storage_bucket = 'post-images'
    on conflict do nothing;
  return query
    with batch as (
      select w.media_id from kc_private.post_media_work w
      join public.post_media m on m.id = w.media_id
      where m.processing_status = 'pending' and w.retry_at <= now()
      order by w.retry_at, w.media_id limit 10 for update of w skip locked
    ), claimed as (
      update kc_private.post_media_work w
         set attempts = w.attempts + 1, retry_at = now() + interval '5 minutes'
        from batch b where w.media_id = b.media_id
      returning w.media_id, w.attempts
    )
    select m.id, m.storage_key, m.mime_type, c.attempts
      from claimed c join public.post_media m on m.id = c.media_id;
end;
$$;

-- The attempt is a fencing token: a late response from an expired lease cannot
-- finish an object already reclaimed by another invocation. Devices have no grant.
create function kc_private.finish_post_media(p_id uuid, p_attempt integer, p_ok boolean)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_outer_role text := coalesce(current_setting('kc.fsm_role', true), '');
  v_attempt integer;
begin
  select attempts into v_attempt from kc_private.post_media_work
   where media_id = p_id for update;
  if v_attempt is distinct from p_attempt or (not p_ok and p_attempt < 3) then return false; end if;
  perform set_config('kc.fsm_role', 'system', true);
  update public.post_media set processing_status = case when p_ok then 'ready' else 'failed' end
   where id = p_id and processing_status = 'pending';
  perform set_config('kc.fsm_role', v_outer_role, true);
  delete from kc_private.post_media_work where media_id = p_id;
  return true;
end;
$$;
revoke all on function kc_private.claim_post_media() from public, anon, authenticated;
revoke all on function kc_private.finish_post_media(uuid, integer, boolean) from public, anon, authenticated;

insert into kc_private.scheduled_jobs(name, schedule, command, timeout, alert_after, description)
values ('post_media_process', '* * * * *', $$select kc_private.invoke_edge_function('process-post-media')$$,
  interval '20 seconds', interval '10 minutes', 'Decode, strip metadata, thumbnail and finish pending post photos, including the backlog.');
-- scheduled_jobs_sync installs the cron entry in the same transaction.
