-- 0452_hide_reported_posts_for_review | D33 / D61 / G33, G20 (S11)
-- docs/spec/07_cross_cutting_systems.md §7.15:
--   * 3 distinct reports on a post (14 days) → `hidden_pending_review` until an
--     admin restores or removes it (was: auto `removed_admin`). Admins keep
--     getting the report + auto-action bubbles in their support threads.
--   * 5 distinct reporters on a user in 30 days → suspended (was: 3 in 14).
--   * A suspended user can still chat with support (was blocked by
--     is_active_member on every message insert and support issue).
-- Function bodies below are the current definitions with only the marked
-- lines changed. Only `open` posts are hidden, so a restore back to `open` is exact.

begin;

-- ── 1. New post status ────────────────────────────────────────────────────
alter table public.posts drop constraint posts_status_check;
alter table public.posts add constraint posts_status_check check (status = any (array[
  'open', 'closed_delivered', 'deleted_no_recipient', 'expired', 'removed_admin', 'hidden_pending_review'
]));

-- ── 2. Who may contact support: active members plus suspended ones (D61). ──
create or replace function public.can_contact_support(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users
     where user_id = uid
       and account_status in ('active', 'suspended_admin', 'suspended_for_false_reports')
  );
$$;
revoke execute on function public.can_contact_support(uuid) from public, anon;
grant execute on function public.can_contact_support(uuid) to authenticated;

-- ── 3. Report effects: thresholds + hide instead of remove ────────────────
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

    -- D61: 5 distinct reporters in 30 days suspend a user; 3 in 14 days act on a post or chat.
    if distinct_reporters >= (case when new.target_type = 'user' then 5 else 3 end) then
      v_threshold_hit := true;
      if new.target_type = 'post' then
        -- D33/D61: hide for human review instead of removing.
        update public.posts set status = 'hidden_pending_review'
         where post_id = new.target_id and status = 'open';
      elsif new.target_type = 'user' then
        update public.users set account_status = 'suspended_admin'
         where user_id = new.target_id
           and account_status not in ('suspended_admin','banned','deleted');
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

-- ── 4. Hidden posts are invisible to everyone but the owner ───────────────
CREATE OR REPLACE FUNCTION public.is_post_visible_to(p_post posts, p_viewer uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when p_post.owner_id = p_viewer then true
    when public.is_blocked(p_viewer, p_post.owner_id) then false
    when exists (
      select 1 from public.reporter_hides h
      where h.reporter_id = p_viewer
        and h.target_type = 'post'
        and h.target_id   = p_post.post_id
    ) then false
    when p_post.status in ('removed_admin','hidden_pending_review','deleted_no_recipient','expired') then false
    when p_post.status = 'closed_delivered' then
      case
        when exists (
          select 1 from public.recipients r
          where r.post_id = p_post.post_id
            and r.recipient_user_id = p_viewer
        ) then true
        when public.participant_closed_surface_visible(p_post, p_post.owner_id, p_viewer) then true
        when exists (
          select 1 from public.recipients r2
          where r2.post_id = p_post.post_id
            and r2.recipient_user_id is not null
            and public.participant_closed_surface_visible(p_post, r2.recipient_user_id, p_viewer)
        ) then true
        else false
      end
    when p_post.status = 'open' and p_post.visibility = 'Public' then true
    when p_post.status = 'open' and p_post.visibility = 'OnlyMe' then false
    when p_post.status = 'open' and p_post.visibility = 'FollowersOnly' then
      public.is_following(p_viewer, p_post.owner_id)
    else false
  end;
$function$;

-- ── 5. Admin restore / remove / search understand the new status ──────────
CREATE OR REPLACE FUNCTION public.admin_restore_target(p_target_type text, p_target_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
     where post_id = p_target_id and status in ('removed_admin', 'hidden_pending_review');
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
$function$;

CREATE OR REPLACE FUNCTION public.admin_remove_post(p_post_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := auth.uid();
begin
  perform public.admin_assert_role(v_actor, array['super_admin','moderator']);

  update public.posts
     -- A post hidden for review was open before it was hidden.
     set status_before_admin_removal = case when status = 'hidden_pending_review' then 'open' else status end,
         status = 'removed_admin',
         updated_at = now()
   where post_id = p_post_id
     and status <> 'removed_admin'
     and status in ('open', 'closed_delivered', 'deleted_no_recipient', 'hidden_pending_review');

  if not found then
    -- Already removed, doesn't exist, or in a terminal state we don't touch.
    -- Quiet no-op preserves legacy idempotency contract (no audit row written).
    return;
  end if;

  insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
  values (v_actor, 'manual_remove_target', 'post', p_post_id, '{}'::jsonb);
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_search_posts(p_query text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(post_id uuid, title text, type text, status text, visibility text, owner_id uuid, owner_display_name text, created_at timestamp with time zone, updated_at timestamp with time zone, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid := auth.uid();
  v_lim   int  := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_off   int  := greatest(coalesce(p_offset, 0), 0);
  v_q     text := nullif(trim(coalesce(p_query, '')), '');
  v_total bigint;
begin
  perform admin_assert_role(v_actor, ARRAY['super_admin','moderator','support']);

  if p_status is not null and p_status not in (
    'open','closed_delivered','deleted_no_recipient','removed_admin','hidden_pending_review','expired'
  ) then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  select count(*) into v_total
    from public.posts p
   where (v_q       is null or p.title ilike '%' || v_q || '%' or p.description ilike '%' || v_q || '%')
     and (p_status  is null or p.status = p_status);

  return query
  select
    p.post_id,
    p.title,
    p.type,
    p.status,
    p.visibility,
    p.owner_id,
    u.display_name as owner_display_name,
    p.created_at,
    p.updated_at,
    v_total as total_count
  from public.posts p
  left join public.users u on u.user_id = p.owner_id
  where (v_q       is null or p.title ilike '%' || v_q || '%' or p.description ilike '%' || v_q || '%')
    and (p_status  is null or p.status = p_status)
  order by
    case p.status when 'open' then 0 when 'closed_delivered' then 1 else 2 end,
    p.updated_at desc
  limit v_lim offset v_off;
end;
$function$;

-- ── 6. Support stays reachable while suspended ────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_submit_support_issue(p_category text, p_description text)
 RETURNS chats
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid      uuid := auth.uid();
  v_chat_id  uuid;
  v_issue_id uuid := gen_random_uuid();
  v_payload  jsonb;
  v_body     text;
  v_chat     public.chats;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = 'check_violation';
  end if;
  if not public.can_contact_support(v_uid) then
    raise exception 'account_not_active' using errcode = 'P0001';
  end if;

  if length(trim(coalesce(p_description, ''))) < 10 then
    raise exception 'description_too_short' using errcode = 'check_violation';
  end if;

  -- Get or create the support thread (reuses the internal helper from 0005).
  v_chat_id := public.find_or_create_support_chat(v_uid);

  -- Build a structured payload so SupportIssueBubble can render it richly.
  v_payload := jsonb_build_object(
    'kind',        'support_issue',
    'issue_id',    v_issue_id,
    'category',    coalesce(nullif(trim(p_category), ''), 'Other'),
    'description', trim(p_description)
  );

  -- Plain-text body: "[Category] description" — shown in inbox preview.
  v_body := '[' || coalesce(nullif(trim(p_category), ''), 'Other') || '] '
            || trim(p_description);

  perform public.inject_system_message(v_chat_id, v_payload, v_body);

  select * into v_chat from public.chats where chat_id = v_chat_id;
  return v_chat;
end;
$function$;

drop policy if exists messages_insert_user on public.messages;
create policy messages_insert_user on public.messages
  for insert to authenticated
  with check (
    auth.uid() = sender_id
    and kind = 'user'
    and system_payload is null
    and status = 'pending'
    and exists (
      select 1 from public.chats c
       where c.chat_id = messages.chat_id
         and c.removed_at is null
         and (auth.uid() = c.participant_a or auth.uid() = c.participant_b)
         and not public.has_blocked(
               case when auth.uid() = c.participant_a then c.participant_b else c.participant_a end,
               auth.uid())
         and (public.is_active_member(auth.uid())
              or (c.is_support_thread and public.can_contact_support(auth.uid())))
    )
  );

commit;
