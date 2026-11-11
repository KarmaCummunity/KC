-- 0120_reports_open_inbox_rpc | FR-ADMIN-012
-- Paginated, grouped-by-target inbox of OPEN report cases.
--
-- Returns a JSON object: { rows: [...], next_cursor: {...} | null }.
-- One row per (target_type, target_id) — duplicate reports on the same target
-- are collapsed into one inbox row with reporter_count = distinct reporters.
--
-- Pagination is cursor-based on ascending (oldest_at, target_type, target_id)
-- because FR-ADMIN-012 AC4 prioritises oldest cases first.
--
-- Cursor protocol:
--   * forward pagination: `(g.oldest_at, g.target_type, g.target_id) > cursor`.
--     next_cursor in the response is the LAST RETURNED row's keys, so the next
--     page picks up strictly after that row.
--   * to detect "is there another page?" we read LIMIT p_limit + 1 and only
--     emit next_cursor when the peek (p_limit+1) row exists.
--   * on the final page, next_cursor is null.
--
-- A regression of any of the above is caught by the integration test
-- app/packages/infrastructure-supabase/src/reports/__tests__/reportsRpc.integration.test.ts
-- (pagination test seeds 27 cases and walks them with limit 10 → [10,10,7]).
--
-- RBAC: super_admin / moderator / support (read-only role can view but not act).

create or replace function public.reports_open_inbox(
  p_target_type_filter text  default null,    -- 'post'|'user'|'chat'|null=any
  p_max_age_days       int   default null,    -- e.g., 30
  p_reporter_filter    uuid  default null,    -- only show cases this user reported
  p_cursor             jsonb default null,    -- {"oldest_at","target_type","target_id"}
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

  if p_limit is null or p_limit < 1 or p_limit > 100 then
    p_limit := 25;
  end if;

  if p_target_type_filter is not null
     and p_target_type_filter not in ('post','user','chat') then
    raise exception 'invalid_target_type_filter' using errcode = '22023';
  end if;

  with grouped as (
    select
      r.target_type,
      r.target_id,
      count(distinct r.reporter_id)::int                          as reporter_count,
      min(r.created_at)                                           as oldest_at,
      (array_agg(r.reporter_id order by r.created_at desc))[1]    as latest_reporter_id,
      case
        when r.target_type = 'post' then (
          select jsonb_build_object(
            'preview',   left(coalesce(p.title, p.description, ''), 120),
            'status',    p.status,
            'author_id', p.owner_id
          ) from public.posts p where p.post_id = r.target_id)
        when r.target_type = 'user' then (
          select jsonb_build_object(
            'display_name', u.display_name,
            'status',       u.account_status
          ) from public.users u where u.user_id = r.target_id)
        when r.target_type = 'chat' then (
          select jsonb_build_object('removed_at', c.removed_at)
            from public.chats c where c.chat_id = r.target_id)
        else '{}'::jsonb
      end as target
    from public.reports r
    where r.status = 'open'
      and r.target_type in ('post','user','chat')
      and r.target_id is not null
      and (p_target_type_filter is null or r.target_type = p_target_type_filter)
      and (p_max_age_days is null
           or r.created_at >= now() - make_interval(days => p_max_age_days))
      and (p_reporter_filter is null
           or exists (
             select 1 from public.reports r2
              where r2.target_type = r.target_type
                and r2.target_id   = r.target_id
                and r2.reporter_id = p_reporter_filter
                and r2.status      = 'open'
           ))
    group by r.target_type, r.target_id
  ),
  paged as (
    select g.*
      from grouped g
     where p_cursor is null
        or (g.oldest_at, g.target_type, g.target_id::text)
           > ((p_cursor->>'oldest_at')::timestamptz,
              p_cursor->>'target_type',
              p_cursor->>'target_id')
     order by g.oldest_at asc, g.target_type asc, g.target_id asc
     limit p_limit + 1
  ),
  numbered as (
    select p.*,
           row_number() over (order by p.oldest_at asc, p.target_type asc, p.target_id asc) as rn
      from paged p
  )
  select jsonb_build_object(
    'rows', coalesce(
      (select jsonb_agg(jsonb_build_object(
         'target_type',        n.target_type,
         'target_id',          n.target_id,
         'reporter_count',     n.reporter_count,
         'oldest_at',          n.oldest_at,
         'latest_reporter_id', n.latest_reporter_id,
         'target',             coalesce(n.target, '{}'::jsonb)
       ) order by n.rn)
       from numbered n
       where n.rn <= p_limit),
      '[]'::jsonb),
    -- next_cursor = keys of the LAST RETURNED row (rn = p_limit), emitted
    -- only when a peek row (rn = p_limit + 1) exists. Strict `>` comparison
    -- on the next call then picks up at the row immediately after.
    'next_cursor', case
      when exists (select 1 from numbered where rn = p_limit + 1)
        then (
          select jsonb_build_object(
            'oldest_at',   n.oldest_at,
            'target_type', n.target_type,
            'target_id',   n.target_id::text
          )
          from numbered n
          where n.rn = p_limit
        )
      else null
    end
  )
    into v_result;

  return v_result;
end;
$$;

revoke execute on function public.reports_open_inbox(text, int, uuid, jsonb, int) from public;
grant  execute on function public.reports_open_inbox(text, int, uuid, jsonb, int) to authenticated;
