-- 0308_whatsapp_admin_dashboard | Issue #939
-- Admin-only RPCs for the WhatsApp ops dashboard: consent, outbound queue,
-- rate-limit hits, recent matches, channel kill switch, resend, block user.
-- Gated with admin_assert_role(super_admin|moderator). Phone numbers masked.

begin;

create or replace function public.whatsapp_mask_wa_id(p_wa_id text)
returns text
language sql
immutable
as $$
  select case
    when p_wa_id is null or length(p_wa_id) = 0 then null
    when length(p_wa_id) <= 4 then repeat('*', length(p_wa_id))
    else repeat('*', greatest(length(p_wa_id) - 4, 0)) || right(p_wa_id, 4)
  end;
$$;

revoke all on function public.whatsapp_mask_wa_id(text) from public;
grant execute on function public.whatsapp_mask_wa_id(text) to authenticated, service_role;

-- Channel kill switch (read + write) ----------------------------------------------------------
create or replace function public.api_whatsapp_admin_get_channel()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.whatsapp_channel_config;
begin
  perform public.admin_assert_role(auth.uid(), array['super_admin','moderator']);
  select * into v_row from public.whatsapp_channel_config limit 1;
  if not found then
    return jsonb_build_object('is_enabled', false, 'phone_number_id', null, 'graph_api_version', null, 'updated_at', null);
  end if;
  return jsonb_build_object(
    'is_enabled', v_row.is_enabled,
    'phone_number_id', v_row.phone_number_id,
    'graph_api_version', v_row.graph_api_version,
    'updated_at', v_row.updated_at
  );
end;
$$;

create or replace function public.api_whatsapp_admin_set_channel_enabled(p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_row public.whatsapp_channel_config;
begin
  perform public.admin_assert_role(v_actor, array['super_admin','moderator']);
  if p_enabled is null then
    raise exception 'enabled_required' using errcode = '22023';
  end if;

  update public.whatsapp_channel_config
     set is_enabled = p_enabled, updated_at = now()
   where true
  returning * into v_row;

  if not found then
    raise exception 'channel_missing' using errcode = 'P0002';
  end if;

  insert into public.whatsapp_consent_events (wa_id, user_id, action, source, keyword, record_id)
  values (
    null, v_actor,
    case when p_enabled then 'opt_in' else 'opt_out' end,
    'admin',
    case when p_enabled then 'kill_switch_enable' else 'kill_switch_disable' end,
    null
  );

  return jsonb_build_object(
    'is_enabled', v_row.is_enabled,
    'phone_number_id', v_row.phone_number_id,
    'graph_api_version', v_row.graph_api_version,
    'updated_at', v_row.updated_at
  );
end;
$$;

-- Overview (last 7 days) ---------------------------------------------------------------------
create or replace function public.api_whatsapp_admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_since timestamptz := now() - interval '7 days';
  v_enabled boolean;
  v_queued int;
  v_sent int;
  v_failed int;
  v_skipped int;
  v_consent_in int;
  v_consent_out int;
  v_sessions int;
  v_matches int;
  v_rate_hits int;
begin
  perform public.admin_assert_role(auth.uid(), array['super_admin','moderator']);

  select coalesce(is_enabled, false) into v_enabled from public.whatsapp_channel_config limit 1;

  select count(*) filter (where status = 'queued'),
         count(*) filter (where status = 'sent'),
         count(*) filter (where status = 'failed'),
         count(*) filter (where status like 'skipped_%')
    into v_queued, v_sent, v_failed, v_skipped
    from public.bot_outbound_messages
   where created_at >= v_since;

  select count(*) filter (where opted_in),
         count(*) filter (where not opted_in)
    into v_consent_in, v_consent_out
    from public.whatsapp_match_consent;

  select count(*) into v_sessions
    from public.bot_conversation_sessions
   where updated_at >= v_since;

  select count(*) into v_matches
    from public.bot_outbound_messages
   where created_at >= v_since
     and template_name = 'match_found_v1'
     and status = 'sent';

  select coalesce(sum(hits), 0)::int into v_rate_hits
    from public.whatsapp_rate_counters
   where window_start >= v_since;

  return jsonb_build_object(
    'channel_enabled', coalesce(v_enabled, false),
    'since', v_since,
    'outbound_queued', coalesce(v_queued, 0),
    'outbound_sent', coalesce(v_sent, 0),
    'outbound_failed', coalesce(v_failed, 0),
    'outbound_skipped', coalesce(v_skipped, 0),
    'consent_opted_in', coalesce(v_consent_in, 0),
    'consent_opted_out', coalesce(v_consent_out, 0),
    'sessions_7d', coalesce(v_sessions, 0),
    'matches_sent_7d', coalesce(v_matches, 0),
    'rate_hits_7d', coalesce(v_rate_hits, 0)
  );
end;
$$;

-- Consent list -------------------------------------------------------------------------------
create or replace function public.api_whatsapp_admin_list_consent(
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  user_id uuid,
  wa_id_masked text,
  consent_status text,
  opted_in boolean,
  opted_in_at timestamptz,
  opted_out_at timestamptz,
  preferred_language text,
  last_inbound_at timestamptz,
  updated_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_lim int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_off int := greatest(coalesce(p_offset, 0), 0);
  v_total bigint;
begin
  perform public.admin_assert_role(auth.uid(), array['super_admin','moderator']);

  select count(*) into v_total
    from public.whatsapp_identities i
    left join public.whatsapp_match_consent c on c.user_id = i.user_id;

  return query
  select i.user_id,
         public.whatsapp_mask_wa_id(i.wa_id),
         i.consent_status,
         coalesce(c.opted_in, false),
         c.opted_in_at,
         c.opted_out_at,
         i.preferred_language,
         i.last_inbound_at,
         greatest(i.updated_at, coalesce(c.updated_at, i.updated_at)),
         v_total
    from public.whatsapp_identities i
    left join public.whatsapp_match_consent c on c.user_id = i.user_id
   order by greatest(i.updated_at, coalesce(c.updated_at, i.updated_at)) desc
   limit v_lim offset v_off;
end;
$$;

-- Outbound queue -----------------------------------------------------------------------------
create or replace function public.api_whatsapp_admin_list_outbound(
  p_status text default null,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  outbound_id uuid,
  user_id uuid,
  wa_id_masked text,
  kind text,
  template_name text,
  language text,
  status text,
  attempts int,
  last_error text,
  created_at timestamptz,
  sent_at timestamptz,
  next_attempt_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_lim int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_off int := greatest(coalesce(p_offset, 0), 0);
  v_total bigint;
  v_since timestamptz := now() - interval '7 days';
begin
  perform public.admin_assert_role(auth.uid(), array['super_admin','moderator']);
  if p_status is not null and p_status not in (
    'queued','sending','sent','failed',
    'skipped_rate_limit','skipped_no_consent','skipped_outside_window',
    'skipped_template_unapproved','skipped_no_identity','skipped_global_cap'
  ) then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  select count(*) into v_total
    from public.bot_outbound_messages o
   where o.created_at >= v_since
     and (p_status is null or o.status = p_status);

  return query
  select o.outbound_id, o.user_id, public.whatsapp_mask_wa_id(o.to_wa_id),
         o.kind, o.template_name, o.language, o.status, o.attempts, o.last_error,
         o.created_at, o.sent_at, o.next_attempt_at, v_total
    from public.bot_outbound_messages o
   where o.created_at >= v_since
     and (p_status is null or o.status = p_status)
   order by o.created_at desc
   limit v_lim offset v_off;
end;
$$;

-- Rate-limit hits ----------------------------------------------------------------------------
create or replace function public.api_whatsapp_admin_list_rate_hits(
  p_limit int default 50
)
returns table (
  bucket text,
  window_start timestamptz,
  hits int
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_lim int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_since timestamptz := now() - interval '7 days';
begin
  perform public.admin_assert_role(auth.uid(), array['super_admin','moderator']);
  return query
  select r.bucket, r.window_start, r.hits
    from public.whatsapp_rate_counters r
   where r.window_start >= v_since
   order by r.window_start desc, r.hits desc
   limit v_lim;
end;
$$;

-- Recent matches sent ------------------------------------------------------------------------
create or replace function public.api_whatsapp_admin_list_recent_matches(
  p_limit int default 50
)
returns table (
  outbound_id uuid,
  user_id uuid,
  wa_id_masked text,
  language text,
  status text,
  payload jsonb,
  created_at timestamptz,
  sent_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_lim int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_since timestamptz := now() - interval '7 days';
begin
  perform public.admin_assert_role(auth.uid(), array['super_admin','moderator']);
  return query
  select o.outbound_id, o.user_id, public.whatsapp_mask_wa_id(o.to_wa_id),
         o.language, o.status, o.payload, o.created_at, o.sent_at
    from public.bot_outbound_messages o
   where o.created_at >= v_since
     and o.template_name = 'match_found_v1'
   order by o.created_at desc
   limit v_lim;
end;
$$;

-- Conversations (last 7 days) ----------------------------------------------------------------
create or replace function public.api_whatsapp_admin_list_conversations(
  p_limit int default 50
)
returns table (
  session_id uuid,
  wa_id_masked text,
  user_id uuid,
  state text,
  listing_id uuid,
  updated_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_lim int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_since timestamptz := now() - interval '7 days';
begin
  perform public.admin_assert_role(auth.uid(), array['super_admin','moderator']);
  return query
  select s.session_id, public.whatsapp_mask_wa_id(i.wa_id), i.user_id,
         s.state, s.listing_id, s.updated_at, s.created_at
    from public.bot_conversation_sessions s
    join public.whatsapp_identities i on i.identity_id = s.identity_id
   where s.updated_at >= v_since
   order by s.updated_at desc
   limit v_lim;
end;
$$;

-- Resend failed/skipped ----------------------------------------------------------------------
create or replace function public.api_whatsapp_admin_resend(p_outbound_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.bot_outbound_messages;
begin
  perform public.admin_assert_role(auth.uid(), array['super_admin','moderator']);
  if p_outbound_id is null then
    raise exception 'outbound_id_required' using errcode = '22023';
  end if;

  select * into v_row from public.bot_outbound_messages where outbound_id = p_outbound_id;
  if not found then
    raise exception 'outbound_not_found' using errcode = 'P0002';
  end if;
  if v_row.status not in ('failed', 'skipped_rate_limit', 'skipped_global_cap', 'skipped_outside_window') then
    raise exception 'not_resendable' using errcode = '22023';
  end if;

  update public.bot_outbound_messages
     set status = 'queued',
         next_attempt_at = now(),
         claimed_at = null,
         last_error = null,
         attempts = 0
   where outbound_id = p_outbound_id;

  perform public.whatsapp_outbound_enqueue(p_outbound_id, 0);
  return 'queued';
end;
$$;

-- Block user (force opt-out) -----------------------------------------------------------------
create or replace function public.api_whatsapp_admin_block_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_wa text;
begin
  perform public.admin_assert_role(v_actor, array['super_admin','moderator']);
  if p_user_id is null then
    raise exception 'user_id_required' using errcode = '22023';
  end if;

  perform public.api_bot_set_match_consent(p_user_id, false);

  update public.whatsapp_identities
     set consent_status = 'opted_out', updated_at = now()
   where user_id = p_user_id;

  select wa_id into v_wa from public.whatsapp_identities where user_id = p_user_id limit 1;

  insert into public.whatsapp_consent_events (wa_id, user_id, action, source, keyword, record_id)
  values (v_wa, p_user_id, 'opt_out', 'admin', 'block', null);

  -- Drop any still-queued proactive messages for this user.
  update public.bot_outbound_messages
     set status = 'skipped_no_consent', last_error = 'admin_block'
   where user_id = p_user_id and status = 'queued' and kind = 'template';
end;
$$;

revoke all on function public.api_whatsapp_admin_get_channel() from public;
revoke all on function public.api_whatsapp_admin_set_channel_enabled(boolean) from public;
revoke all on function public.api_whatsapp_admin_overview() from public;
revoke all on function public.api_whatsapp_admin_list_consent(int, int) from public;
revoke all on function public.api_whatsapp_admin_list_outbound(text, int, int) from public;
revoke all on function public.api_whatsapp_admin_list_rate_hits(int) from public;
revoke all on function public.api_whatsapp_admin_list_recent_matches(int) from public;
revoke all on function public.api_whatsapp_admin_list_conversations(int) from public;
revoke all on function public.api_whatsapp_admin_resend(uuid) from public;
revoke all on function public.api_whatsapp_admin_block_user(uuid) from public;

grant execute on function public.api_whatsapp_admin_get_channel() to authenticated;
grant execute on function public.api_whatsapp_admin_set_channel_enabled(boolean) to authenticated;
grant execute on function public.api_whatsapp_admin_overview() to authenticated;
grant execute on function public.api_whatsapp_admin_list_consent(int, int) to authenticated;
grant execute on function public.api_whatsapp_admin_list_outbound(text, int, int) to authenticated;
grant execute on function public.api_whatsapp_admin_list_rate_hits(int) to authenticated;
grant execute on function public.api_whatsapp_admin_list_recent_matches(int) to authenticated;
grant execute on function public.api_whatsapp_admin_list_conversations(int) to authenticated;
grant execute on function public.api_whatsapp_admin_resend(uuid) to authenticated;
grant execute on function public.api_whatsapp_admin_block_user(uuid) to authenticated;

commit;
