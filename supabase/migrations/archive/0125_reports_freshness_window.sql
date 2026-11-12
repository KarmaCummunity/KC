-- 0125_reports_freshness_window | FR-MOD-001 — closes TD-94 (6)
--
-- Add a 14-day freshness window to the auto-removal threshold. Without it,
-- a year-old open report can tip a target into auto-removal the moment a
-- new report arrives today — counts stay anchored on stale signal forever.
--
-- The 14-day window matches the operational expectation that reports get
-- triaged within ~2 weeks; older 'open' rows have effectively been stale-
-- forgotten by the moderation team and shouldn't carry threshold weight.
-- The number is intentionally inline (not in a settings table) — one knob,
-- one place to tune; revisit only if the moderation cadence changes.
--
-- This is a behavior change: targets that previously would have auto-
-- removed on the next fresh report will now require 3 distinct fresh
-- reporters. Already-removed targets are unaffected.
--
-- The same `distinct_reporters` variable feeds:
--   - the threshold guard (`if distinct_reporters >= 3 then ...`)
--   - the auto_remove_target audit metadata (`{distinct_reporters: N}`)
--   - the admin-side auto_removed system bubble (step 6 payload)
-- Restricting the count source once keeps all three in sync automatically.
--
-- Every other line in the function is preserved verbatim from 0047:
--   * pg_advisory_xact_lock for per-target serialization.
--   * reporter_hides INSERT, audit log, payload enrichment for link_target
--     and target_preview.
--   * report_received and owner_auto_removed best-effort bubbles.
--
-- The trigger binding `reports_after_insert_effects` (created in 0005) still
-- targets this function name, so no DROP/CREATE TRIGGER is needed.

create or replace function public.reports_after_insert_apply_effects()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
       and created_at >= now() - interval '14 days';

    if distinct_reporters >= 3 then
      v_threshold_hit := true;
      if new.target_type = 'post' then
        update public.posts set status = 'removed_admin'
         where post_id = new.target_id and status <> 'removed_admin';
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
                               'target_id', new.target_id),
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
$$;
