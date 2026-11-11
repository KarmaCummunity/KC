-- 0047_report_admin_payload_enrichment | FR-MOD-001 AC4 + FR-MOD-005 AC3
--
-- Replaces reports_after_insert_apply_effects (originally 0005, last
-- replaced in 0040) to:
--   - enrich the report_received system_payload with link_target +
--     target_preview (snapshot at INSERT time);
--   - on threshold breach (FR-MOD-005), emit a NEW kind='auto_removed'
--     system message into the 3rd reporter's support thread with the
--     same enriched payload — closes FR-MOD-005 AC3 which had no BE
--     implementation.
--
-- Also drops the obsolete reports_after_insert_emit_message trigger
-- defined in 0013 — it produced kind='report' duplicates that the
-- dispatcher never rendered (latent dead noise + double-write).
--
-- Privacy floor for MVP is UI-side (admin-gated bubble render). DB-level
-- visibility predicate and RTBF scrub are TD (see TECH_DEBT.md).
--
-- The trigger binding `reports_after_insert_effects` (on public.reports)
-- defined in 0005 still references this function — no recreation needed.

-- ── 0. drop obsolete duplicate-emitter trigger from 0013 ────────────────────
drop trigger if exists reports_after_insert_emit_message on public.reports;

-- ── 1. reports_after_insert_apply_effects — enriched payload ────────────────
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

    select count(distinct reporter_id) into distinct_reporters
      from public.reports
     where target_type = new.target_type
       and target_id   = new.target_id
       and status      = 'open';

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

  -- (6) NEW — admin-side auto_removed bubble in the 3rd reporter's thread.
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

-- ════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (operator: paste & execute the block below to revert this migration
-- in production. CREATE OR REPLACE FUNCTION cannot be reverted via git revert.)
-- ════════════════════════════════════════════════════════════════════════════
--
-- create or replace function public.reports_after_insert_apply_effects()
-- returns trigger
-- language plpgsql
-- security definer
-- set search_path = public
-- as $$
-- declare
--   distinct_reporters int;
--   v_chat        uuid;
--   v_threshold_hit boolean := false;
--   v_owner_id    uuid;
--   v_owner_chat  uuid;
-- begin
--   if new.target_type <> 'none' then
--     insert into public.reporter_hides (reporter_id, target_type, target_id)
--     values (new.reporter_id, new.target_type, new.target_id)
--     on conflict do nothing;
--   end if;
--   insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
--   values (new.reporter_id, 'report_target', new.target_type, new.target_id,
--           jsonb_build_object('report_id', new.report_id, 'reason', new.reason));
--   if new.target_type <> 'none' then
--     perform pg_advisory_xact_lock(
--       hashtext('mod_target_' || new.target_type || '_' || new.target_id::text)::bigint);
--     select count(distinct reporter_id) into distinct_reporters
--       from public.reports
--      where target_type = new.target_type and target_id = new.target_id and status = 'open';
--     if distinct_reporters >= 3 then
--       v_threshold_hit := true;
--       if new.target_type = 'post' then
--         update public.posts set status = 'removed_admin' where post_id = new.target_id and status <> 'removed_admin';
--       elsif new.target_type = 'user' then
--         update public.users set account_status = 'suspended_admin'
--          where user_id = new.target_id and account_status not in ('suspended_admin','banned','deleted');
--       elsif new.target_type = 'chat' then
--         update public.chats set removed_at = now() where chat_id = new.target_id and removed_at is null;
--       end if;
--       insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
--       values (null, 'auto_remove_target', new.target_type, new.target_id,
--               jsonb_build_object('distinct_reporters', distinct_reporters));
--     end if;
--   end if;
--   begin
--     v_chat := public.find_or_create_support_chat(new.reporter_id);
--     if v_chat is not null then
--       perform public.inject_system_message(v_chat,
--         jsonb_build_object('kind', 'report_received', 'report_id', new.report_id,
--                            'target_type', new.target_type, 'target_id', new.target_id,
--                            'reason', new.reason),
--         null);
--     end if;
--   exception when others then
--     raise warning 'admin-side report_received message failed: % (state %, report_id %)',
--       sqlerrm, sqlstate, new.report_id;
--   end;
--   if v_threshold_hit then
--     begin
--       v_owner_id := case new.target_type
--         when 'post' then (select owner_id from public.posts where post_id = new.target_id)
--         when 'user' then new.target_id else null end;
--       if v_owner_id is not null and v_owner_id <> new.reporter_id then
--         v_owner_chat := public.find_or_create_support_chat(v_owner_id);
--         if v_owner_chat is not null then
--           perform public.inject_system_message(v_owner_chat,
--             jsonb_build_object('kind', 'owner_auto_removed',
--                                'target_type', new.target_type,
--                                'target_id', new.target_id),
--             null);
--         end if;
--       end if;
--     exception when others then
--       raise warning 'owner_auto_removed message failed: % (state %, target %/%)',
--         sqlerrm, sqlstate, new.target_type, new.target_id;
--     end;
--   end if;
--   return new;
-- end;
-- $$;
--
-- (Note: re-creating the dropped 0013 trigger is intentionally omitted — the
-- duplicate it produced is a bug, not desired behaviour.)
