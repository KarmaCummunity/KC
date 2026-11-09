-- 0697_fsm_account_status_writers | Wave 3a-2 of the FSM kernel program (#1989, G61)
--
-- The report auto-action (`reports_after_insert_apply_effects`, 0452) on the account graph (0696):
--   * it asks the shared D61 rule (`kc_private.report_threshold_reached`) instead of its own copy
--     of the thresholds, so the rule that imposes an action is the rule that lifts it (PM
--     decision 2026-11-09, wave 3a);
--   * it suspends only a live account. Before, it also moved an account under deletion, which
--     failed `users_pending_deletion_purge_chk` and so refused the reporter's report.
-- The body is the 0452 one, verbatim except the two places marked `0697`.
--
-- `admin_search_users` (0149) filters by the graph's states: `pending_deletion` instead of `deleted`,
-- so the admin status chip for accounts under deletion works.

CREATE OR REPLACE FUNCTION public.reports_after_insert_apply_effects()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  distinct_reporters int;
  v_chat              uuid;
  v_threshold_hit     boolean := false;
  v_owner_id          uuid;
  v_owner_chat        uuid;
  -- enrichment locals
  v_target_user_id    uuid;
  v_chat_is_support   boolean;
  v_link_handle       text;
  v_link_target       jsonb := null;
  v_target_preview    jsonb := null;
  v_payload           jsonb;
begin
  -- (1) Reporter-side hide (no-op for target_type='none').
  if new.target_type <> 'none' then
    insert into public.reporter_hides (reporter_id, target_type, target_id)
    values (new.reporter_id, new.target_type, new.target_id)
    on conflict do nothing;
  end if;

  -- (2) Audit.
  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (
    new.reporter_id,
    'report_target',
    new.target_type,
    new.target_id,
    jsonb_build_object('report_id', new.report_id, 'reason', new.reason)
  );

  -- (3) Auto-removal threshold (skipped for target_type='none').
  if new.target_type <> 'none' then
    perform pg_advisory_xact_lock(
      hashtext('mod_target_' || new.target_type || '_' || new.target_id::text)::bigint);

    -- TD-94 (6) freshness window: only reports filed within the last 14 days
    -- count toward the auto-removal threshold. The current INSERT is by
    -- definition fresh (created_at = now()).
    select count(distinct reporter_id) into distinct_reporters
      from public.reports
     where target_type = new.target_type
       and target_id   = new.target_id
       and status      = 'open'
       and created_at >= now() - case when new.target_type = 'user'
                                      then interval '30 days' else interval '14 days' end;

    -- D61 (0697): the shared rule decides; the count above is kept for the audit row.
    if kc_private.report_threshold_reached(new.target_type, new.target_id) then
      v_threshold_hit := true;
      if new.target_type = 'post' then
        -- D33/D61: hide for human review instead of removing.
        update public.posts set status = 'hidden_pending_review'
         where post_id = new.target_id and status = 'open';
      elsif new.target_type = 'user' then
        -- 0697: only a live account is suspended; a ban stays, and an account under deletion
        -- is leaving (the account_status graph, 0696, has no such move).
        update public.users set account_status = 'suspended_admin'
         where user_id = new.target_id
           and account_status in ('pending_verification', 'active', 'suspended_for_false_reports');
      elsif new.target_type = 'chat' then
        update public.chats set removed_at = now()
         where chat_id = new.target_id and removed_at is null;
      end if;

      insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
      values (null, 'auto_remove_target', new.target_type, new.target_id,
              jsonb_build_object('distinct_reporters', distinct_reporters));
    end if;
  end if;

  -- ── ENRICHMENT — build link_target + target_preview ───────────────────────
  -- Resolve "the user being reported" (target_type=user, or chat→counterpart).
  -- For post: link points at the post; preview is post-shaped.
  -- For chat: reject is_support_thread=true (counterpart would be admin).
  if new.target_type = 'post' then
    select jsonb_build_object(
      'type', 'post',
      'id',   p.post_id,
      'handle', u.share_handle
    ),
    jsonb_build_object(
      'kind', 'post',
      'author_handle',       u.share_handle,
      'author_display_name', u.display_name,
      'body_snippet', nullif(trim(regexp_replace(
        left(p.title || coalesce(' — ' || p.description, ''), 80),
        '\s+', ' ', 'g'
      )), ''),
      'has_image', exists (select 1 from public.media_assets m where m.post_id = p.post_id)
    )
    into v_link_target, v_target_preview
    from public.posts p
    join public.users u on u.user_id = p.owner_id
    where p.post_id = new.target_id;

  elsif new.target_type = 'user' then
    v_target_user_id := new.target_id;
    select share_handle into v_link_handle from public.users where user_id = v_target_user_id;
    if v_link_handle is not null then
      v_link_target := jsonb_build_object('type', 'user', 'id', v_target_user_id, 'handle', v_link_handle);
    end if;

    select jsonb_build_object(
      'kind', 'user',
      'handle', share_handle,
      'display_name', display_name,
      'bio_snippet', nullif(trim(regexp_replace(left(coalesce(biography, ''), 80), '\s+', ' ', 'g')), '')
    ) into v_target_preview
    from public.users where user_id = v_target_user_id;

  elsif new.target_type = 'chat' then
    select
      case when participant_a = new.reporter_id then participant_b else participant_a end,
      is_support_thread
    into v_target_user_id, v_chat_is_support
    from public.chats where chat_id = new.target_id;

    if v_target_user_id is not null and coalesce(v_chat_is_support, false) = false then
      select share_handle into v_link_handle from public.users where user_id = v_target_user_id;
      if v_link_handle is not null then
        v_link_target := jsonb_build_object('type', 'user', 'id', v_target_user_id, 'handle', v_link_handle);
      end if;

      select jsonb_build_object(
        'kind', 'user',
        'handle', share_handle,
        'display_name', display_name,
        'bio_snippet', nullif(trim(regexp_replace(left(coalesce(biography, ''), 80), '\s+', ' ', 'g')), '')
      ) into v_target_preview
      from public.users where user_id = v_target_user_id;
    end if;
  end if;
  -- target_type='none' leaves v_link_target/v_target_preview null.

  -- (4) Best-effort admin-side support-thread message (report_received).
  begin
    v_chat := public.find_or_create_support_chat(new.reporter_id);
    if v_chat is not null then
      v_payload := jsonb_build_object(
        'kind',        'report_received',
        'report_id',   new.report_id,
        'target_type', new.target_type,
        'target_id',   new.target_id,
        'reason',      new.reason,
        'link_target', v_link_target,
        'target_preview', v_target_preview
      );
      perform public.inject_system_message(v_chat, v_payload, null);
    end if;
  exception when others then
    raise warning 'admin-side report_received message failed: % (state %, report_id %)',
      sqlerrm, sqlstate, new.report_id;
  end;

  -- (5) Best-effort owner-side notification on auto-removal.
  -- Owner = post.owner_id (post target) or the suspended user (user target).
  if v_threshold_hit then
    begin
      v_owner_id := case new.target_type
        when 'post' then (select owner_id from public.posts where post_id = new.target_id)
        when 'user' then new.target_id
        else null
      end;
      if v_owner_id is not null and v_owner_id <> new.reporter_id then
        v_owner_chat := public.find_or_create_support_chat(v_owner_id);
        if v_owner_chat is not null then
          perform public.inject_system_message(v_owner_chat,
            jsonb_build_object('kind', 'owner_auto_removed',
                               'target_type', new.target_type,
                               'target_id', new.target_id,
                               'outcome', case when new.target_type = 'post'
                                               then 'hidden_pending_review' end),
            null);
        end if;
      end if;
    exception when others then
      raise warning 'owner_auto_removed message failed: % (state %, target %/%)',
        sqlerrm, sqlstate, new.target_type, new.target_id;
    end;
  end if;

  -- (6) admin-side auto_removed bubble in the 3rd reporter's thread.
  if v_threshold_hit then
    begin
      -- Reuse v_chat (already the reporter's support thread). If the (4) block
      -- above failed and v_chat is null, retry resolution.
      if v_chat is null then
        v_chat := public.find_or_create_support_chat(new.reporter_id);
      end if;
      if v_chat is not null then
        perform public.inject_system_message(
          v_chat,
          jsonb_build_object(
            'kind',               'auto_removed',
            'target_type',        new.target_type,
            'target_id',          new.target_id,
            'distinct_reporters', distinct_reporters,
            'link_target',        v_link_target,
            'target_preview',     v_target_preview
          ),
          null
        );
      end if;
    exception when others then
      raise warning 'admin-side auto_removed message failed: % (state %, target %/%)',
        sqlerrm, sqlstate, new.target_type, new.target_id;
    end;
  end if;

  return new;
end;
$function$;

-- ── admin_search_users (0149): the graph's states ─────────────────────────────
create or replace function public.admin_search_users(
  p_query  text default null,
  p_status text default null,
  p_limit  int  default 50,
  p_offset int  default 0
)
returns table (
  user_id        uuid,
  display_name   text,
  share_handle   text,
  account_status text,
  city_name      text,
  created_at     timestamptz,
  last_seen_at   timestamptz,
  total_count    bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_lim   int  := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_off   int  := greatest(coalesce(p_offset, 0), 0);
  v_q     text := nullif(trim(coalesce(p_query, '')), '');
  v_total bigint;
begin
  perform admin_assert_role(v_actor, ARRAY['super_admin','moderator','support']);

  if p_status is not null and p_status not in (
    -- 0697: the account_status graph's states (0696); `deleted` is not one, a purge removes the row.
    'active','pending_verification','banned','suspended_admin','suspended_for_false_reports','pending_deletion'
  ) then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  select count(*) into v_total
    from public.users u
   where (v_q       is null or u.display_name ilike '%' || v_q || '%' or u.share_handle ilike '%' || v_q || '%')
     and (p_status  is null or u.account_status = p_status);

  return query
  select
    u.user_id,
    u.display_name,
    u.share_handle,
    u.account_status,
    u.city_name,
    u.created_at,
    u.last_seen_at,
    v_total as total_count
  from public.users u
  where (v_q       is null or u.display_name ilike '%' || v_q || '%' or u.share_handle ilike '%' || v_q || '%')
    and (p_status  is null or u.account_status = p_status)
  order by
    case u.account_status when 'active' then 0 when 'pending_verification' then 1 else 2 end,
    u.last_seen_at desc nulls last,
    u.created_at desc
  limit v_lim offset v_off;
end;
$$;
