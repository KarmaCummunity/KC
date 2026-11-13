-- 0339_admin_listing_reports | Listing targets in admin inbox, restore, and auto-remove.

begin;

create or replace function public.admin_remove_listing(p_listing_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  perform public.admin_assert_role(v_actor, array['super_admin','moderator']);

  update public.listings
     set status = 'removed_admin', updated_at = now()
   where listing_id = p_listing_id
     and status <> 'removed_admin';

  if not found then return; end if;

  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (v_actor, 'manual_remove_target', 'listing', p_listing_id, '{}'::jsonb);
end;
$$;

revoke all on function public.admin_remove_listing(uuid) from public;
grant execute on function public.admin_remove_listing(uuid) to authenticated;

create or replace function public.admin_restore_target(
  p_target_type text,
  p_target_id   uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor     uuid := auth.uid();
  v_changed   boolean := false;
  v_reporters uuid[];
begin
  perform public.admin_assert_role(v_actor, array['super_admin','moderator']);

  if p_target_type not in ('post','user','chat','listing') then
    raise exception 'invalid_target_type' using errcode = 'P0010';
  end if;

  if p_target_type = 'post' then
    if not exists (select 1 from public.posts where post_id = p_target_id) then
      raise exception 'target_not_found' using errcode = 'P0017', detail = 'post';
    end if;
  elsif p_target_type = 'user' then
    if not exists (select 1 from public.users where user_id = p_target_id) then
      raise exception 'target_not_found' using errcode = 'P0017', detail = 'user';
    end if;
  elsif p_target_type = 'chat' then
    if not exists (select 1 from public.chats where chat_id = p_target_id) then
      raise exception 'target_not_found' using errcode = 'P0017', detail = 'chat';
    end if;
  elsif p_target_type = 'listing' then
    if not exists (select 1 from public.listings where listing_id = p_target_id) then
      raise exception 'target_not_found' using errcode = 'P0017', detail = 'listing';
    end if;
  end if;

  if p_target_type = 'post' then
    update public.posts set status = 'open', updated_at = now()
     where post_id = p_target_id and status = 'removed_admin';
    v_changed := found;
  elsif p_target_type = 'user' then
    if exists (select 1 from public.users
               where user_id = p_target_id
                 and account_status not in ('suspended_admin','active')) then
      raise exception 'invalid_restore_state'
        using errcode = 'P0011', detail = 'user not in suspended_admin state';
    end if;
    update public.users set account_status = 'active'
     where user_id = p_target_id and account_status = 'suspended_admin';
    v_changed := found;
  elsif p_target_type = 'chat' then
    update public.chats set removed_at = null
     where chat_id = p_target_id and removed_at is not null;
    v_changed := found;
  elsif p_target_type = 'listing' then
    update public.listings set status = 'open', updated_at = now()
     where listing_id = p_target_id and status = 'removed_admin';
    v_changed := found;
  end if;

  if not v_changed then return; end if;

  select coalesce(array_agg(distinct reporter_id order by reporter_id), array[]::uuid[])
    into v_reporters
    from public.reports
   where target_type = p_target_type
     and target_id   = p_target_id
     and status      = 'open';

  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (v_actor, 'restore_target', p_target_type, p_target_id,
          jsonb_build_object('distinct_reporters', to_jsonb(v_reporters)));
end;
$$;

revoke execute on function public.admin_restore_target(text, uuid) from public;
grant execute on function public.admin_restore_target(text, uuid) to authenticated;

create or replace function public.reports_listing_auto_remove_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  distinct_reporters int;
begin
  if new.target_type <> 'listing' or new.target_id is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtext('mod_target_listing_' || new.target_id::text)::bigint);

  select count(distinct reporter_id) into distinct_reporters
    from public.reports
   where target_type = 'listing'
     and target_id   = new.target_id
     and status      = 'open'
     and created_at >= now() - interval '14 days';

  if distinct_reporters >= 3 then
    update public.listings
       set status = 'removed_admin', updated_at = now()
     where listing_id = new.target_id
       and status <> 'removed_admin';

    if found then
      insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
      values (null, 'auto_remove_target', 'listing', new.target_id,
              jsonb_build_object('distinct_reporters', distinct_reporters));
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists reports_listing_auto_remove_trg on public.reports;
create trigger reports_listing_auto_remove_trg
  after insert on public.reports
  for each row execute function public.reports_listing_auto_remove_on_insert();

-- reports_open_inbox + reports_case_detail: listing branch (FR-ADMIN-012/013).
create or replace function public.reports_open_inbox(
  p_target_type_filter text  default null,
  p_max_age_days       int   default null,
  p_reporter_filter    uuid  default null,
  p_cursor             jsonb default null,
  p_limit              int   default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_result jsonb;
begin
  perform public.admin_assert_role(v_actor, array['super_admin','moderator','support']);

  if p_limit is null or p_limit < 1 or p_limit > 100 then p_limit := 25; end if;

  if p_target_type_filter is not null
     and p_target_type_filter not in ('post','user','chat','listing') then
    raise exception 'invalid_target_type_filter' using errcode = '22023';
  end if;

  with grouped as (
    select
      r.target_type,
      r.target_id,
      count(distinct r.reporter_id)::int as reporter_count,
      min(r.created_at) as oldest_at,
      (array_agg(r.reporter_id order by r.created_at desc))[1] as latest_reporter_id,
      case
        when r.target_type = 'post' then (
          select jsonb_build_object(
            'preview', left(coalesce(p.title, p.description, ''), 120),
            'status', p.status,
            'author_id', p.owner_id
          ) from public.posts p where p.post_id = r.target_id)
        when r.target_type = 'user' then (
          select jsonb_build_object(
            'display_name', u.display_name,
            'status', u.account_status
          ) from public.users u where u.user_id = r.target_id)
        when r.target_type = 'chat' then (
          select jsonb_build_object('removed_at', c.removed_at)
            from public.chats c where c.chat_id = r.target_id)
        when r.target_type = 'listing' then (
          select jsonb_build_object(
            'preview', left(coalesce(l.title, l.summary, ''), 120),
            'status', l.status,
            'owner_id', l.owner_id,
            'world_slug', l.world_slug
          ) from public.listings l where l.listing_id = r.target_id)
        else '{}'::jsonb
      end as target
    from public.reports r
    where r.status = 'open'
      and r.target_type in ('post','user','chat','listing')
      and r.target_id is not null
      and (p_target_type_filter is null or r.target_type = p_target_type_filter)
      and (p_max_age_days is null or r.created_at >= now() - make_interval(days => p_max_age_days))
      and (p_reporter_filter is null or exists (
             select 1 from public.reports r2
              where r2.target_type = r.target_type and r2.target_id = r.target_id
                and r2.reporter_id = p_reporter_filter and r2.status = 'open'))
    group by r.target_type, r.target_id
  ),
  paged as (
    select g.* from grouped g
     where p_cursor is null
        or (g.oldest_at, g.target_type, g.target_id::text)
           > ((p_cursor->>'oldest_at')::timestamptz, p_cursor->>'target_type', p_cursor->>'target_id')
     order by g.oldest_at asc, g.target_type asc, g.target_id asc
     limit p_limit + 1
  ),
  numbered as (
    select p.*, row_number() over (order by p.oldest_at asc, p.target_type asc, p.target_id asc) as rn
      from paged p
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
         'target_type', n.target_type, 'target_id', n.target_id,
         'reporter_count', n.reporter_count, 'oldest_at', n.oldest_at,
         'latest_reporter_id', n.latest_reporter_id,
         'target', coalesce(n.target, '{}'::jsonb)) order by n.rn)
       from numbered n where n.rn <= p_limit), '[]'::jsonb),
    'next_cursor', case when exists (select 1 from numbered where rn = p_limit + 1) then (
          select jsonb_build_object('oldest_at', n.oldest_at, 'target_type', n.target_type, 'target_id', n.target_id::text)
          from numbered n where n.rn = p_limit) else null end
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.reports_case_detail(
  p_target_type text,
  p_target_id   uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_target jsonb;
  v_reporters jsonb;
  v_timeline jsonb;
begin
  perform public.admin_assert_role(v_actor, array['super_admin','moderator','support']);

  if p_target_type not in ('post','user','chat','listing') or p_target_id is null then
    raise exception 'invalid_target' using errcode = '22023';
  end if;

  if p_target_type = 'post' then
    select jsonb_build_object(
      'preview', left(coalesce(p.title, p.description, ''), 280),
      'status', p.status, 'author_id', p.owner_id, 'created_at', p.created_at
    ) into v_target from public.posts p where p.post_id = p_target_id;
  elsif p_target_type = 'user' then
    select jsonb_build_object(
      'display_name', u.display_name, 'status', u.account_status, 'created_at', u.created_at
    ) into v_target from public.users u where u.user_id = p_target_id;
  elsif p_target_type = 'chat' then
    select jsonb_build_object('removed_at', c.removed_at) into v_target
      from public.chats c where c.chat_id = p_target_id;
  elsif p_target_type = 'listing' then
    select jsonb_build_object(
      'preview', left(coalesce(l.title, l.summary, ''), 280),
      'status', l.status, 'owner_id', l.owner_id,
      'world_slug', l.world_slug, 'created_at', l.created_at
    ) into v_target from public.listings l where l.listing_id = p_target_id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'report_id', r.report_id, 'reporter_id', r.reporter_id,
    'reporter_name', u.display_name, 'reason', r.reason, 'note', r.note,
    'status', r.status, 'created_at', r.created_at,
    'resolved_at', r.resolved_at, 'resolved_by', r.resolved_by
  ) order by r.created_at asc), '[]'::jsonb)
    into v_reporters
    from public.reports r
    left join public.users u on u.user_id = r.reporter_id
   where r.target_type = p_target_type and r.target_id = p_target_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'event_id', e.event_id, 'actor_id', e.actor_id, 'action', e.action,
    'metadata', e.metadata, 'created_at', e.created_at
  ) order by e.created_at desc), '[]'::jsonb)
    into v_timeline
    from public.audit_events e
   where e.target_type = p_target_type and e.target_id = p_target_id;

  return jsonb_build_object(
    'target_type', p_target_type, 'target_id', p_target_id,
    'target', coalesce(v_target, '{}'::jsonb),
    'reporters', v_reporters, 'timeline', v_timeline
  );
end;
$$;

commit;
