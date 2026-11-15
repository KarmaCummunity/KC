-- WhatsApp bot · linking a number, the member's switches and the agent's tools (M22 / L7)
--
-- Linking (#1090): a Pro member asks the app for a 6-digit code (10 minutes, hash only) and
-- sends it to the KC number; the webhook redeems it. One number per member. A number is
-- locked for an hour after five failed codes.
--
-- Member RPCs (authenticated): api_whatsapp_create_link_code, api_whatsapp_my_link_status,
-- api_whatsapp_unlink_me, api_whatsapp_set_match_consent (the alert opt-in toggle).
--
-- Agent tools (service role, #1091), always for one explicit, active member passed by the
-- webhook; the model never chooses whose data it reads or posts as:
--   api_bot_search_posts, api_bot_post_cards, api_bot_my_posts, api_bot_my_matches
--   api_bot_open_session → api_bot_apply_extraction → api_bot_publish_post
-- Visibility for that member follows the posts RLS (kc_private.whatsapp_post_visible_to),
-- with no impersonation of a session. A bot post is a native post of its linked owner,
-- shown at city level. Confidence ≥ 0.85 publishes it; below that it stays a draft with a
-- review item, and an extraction below 0.75 is queued for review at once. An offer in a
-- photo world (D132) is kept as a draft until the owner adds its photo in the app.
--
-- Errors (P0001 unless noted): pro_required, rate_limited, invalid_input, wa_id_required,
-- user_id_required, account_not_active, session_not_found, session_not_ready, kind_not_found,
-- invalid_direction, invalid_title, invalid_confidence, city_required, and the post's own
-- errors (food_expiry_required, post_limit_exceeded, …); owner_mismatch is 42501.

-- ── Linking ─────────────────────────────────────────────────────────────────
insert into kc_private.rate_limits (action, max_count, "window", description) values
  ('whatsapp_link_code', 10, interval '1 hour', 'WhatsApp link codes issued. Enforced in public.api_whatsapp_create_link_code.');

-- Issues a fresh code for the caller (replacing any previous one): {code, expires_at}.
create function public.api_whatsapp_create_link_code()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user constant uuid := kc_private.require_active_caller();
  v_expires constant timestamptz := now() + interval '10 minutes';
  v_code text;
begin
  if not kc_private.is_pro(v_user) then
    raise exception 'pro_required' using errcode = 'P0001';
  end if;
  perform kc_private.rate_limit_enforce('whatsapp_link_code', v_user);
  -- gen_random_uuid() draws from the server's CSPRNG; 32 of its bits make the six digits.
  v_code := lpad(((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint) % 1000000)::text,
                 6, '0');
  insert into integrations.whatsapp_link_codes as c (user_id, code_hash, expires_at)
  values (v_user, kc_private.whatsapp_link_code_hash(v_code), v_expires)
  on conflict (user_id) do update set code_hash = excluded.code_hash, expires_at = excluded.expires_at, created_at = now();
  return jsonb_build_object('code', v_code, 'expires_at', v_expires);
end;
$$;
comment on function public.api_whatsapp_create_link_code() is 'Pro member: a one-time code (10 minutes) that links a WhatsApp number.';
grant execute on function public.api_whatsapp_create_link_code() to authenticated;

-- The caller's link: {linked, wa_id_masked, is_pro, consent_opted_in, phone_opted_out}.
create function public.api_whatsapp_my_link_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user constant uuid := kc_private.require_caller();
  v_identity integrations.whatsapp_identities;
begin
  select i.* into v_identity from integrations.whatsapp_identities i
   where i.user_id = v_user order by i.updated_at desc limit 1;
  return jsonb_build_object(
    'linked', v_identity.id is not null,
    'wa_id_masked', case when v_identity.id is not null then '•••' || right(v_identity.wa_id, 4) end,
    'is_pro', kc_private.is_pro(v_user),
    'consent_opted_in', coalesce((select c.opted_in from integrations.whatsapp_consents c where c.user_id = v_user), false),
    'phone_opted_out', coalesce(v_identity.consent_status = 'opted_out', false));
end;
$$;
comment on function public.api_whatsapp_my_link_status() is 'Member: whether a WhatsApp number is linked (masked), Pro and alert consent.';
grant execute on function public.api_whatsapp_my_link_status() to authenticated;

-- Unlinks every number of the caller. The phone rows and their consent history stay.
create function public.api_whatsapp_unlink_me()
returns void
language sql
security definer
set search_path = ''
as $$
  update integrations.whatsapp_identities i set user_id = null where i.user_id = kc_private.require_caller();
$$;
comment on function public.api_whatsapp_unlink_me() is 'Member: unlinks the caller''s WhatsApp number.';
grant execute on function public.api_whatsapp_unlink_me() to authenticated;

-- The caller's own switch for WhatsApp match alerts. An opt-out also stops their numbers;
-- an opt-in never lifts a STOP sent from the phone. Opting in sends the opt-in confirmation
-- template when a number is linked. Returns the new status, as api_whatsapp_my_link_status.
create function public.api_whatsapp_set_match_consent(p_opted_in boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user constant uuid := kc_private.require_active_caller();
begin
  if p_opted_in is null then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  perform kc_private.whatsapp_set_user_consent(v_user, p_opted_in, 'app');
  if p_opted_in and exists (select 1 from integrations.whatsapp_identities i where i.user_id = v_user) then
    perform kc_private.whatsapp_queue_template(v_user, 'opt_in_confirm_v1', '{}'::jsonb);
  end if;
  return public.api_whatsapp_my_link_status();
end;
$$;
comment on function public.api_whatsapp_set_match_consent(boolean) is 'Member: turns WhatsApp match alerts on or off for the caller.';
grant execute on function public.api_whatsapp_set_match_consent(boolean) to authenticated;

-- Redeems a code sent from a number: {status: linked | invalid | locked | not_pro, user_id}.
create function public.api_whatsapp_redeem_link_code(p_wa_id text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  if p_wa_id is null or btrim(p_wa_id) = '' then
    raise exception 'wa_id_required' using errcode = 'P0001';
  end if;
  if (select count(*) from integrations.whatsapp_link_failures f
       where f.wa_id = p_wa_id and f.failed_at > now() - interval '1 hour') >= 5 then
    return jsonb_build_object('status', 'locked');
  end if;
  select c.user_id into v_user from integrations.whatsapp_link_codes c
   where c.code_hash = kc_private.whatsapp_link_code_hash(p_code) and c.expires_at > now();
  if v_user is null then
    insert into integrations.whatsapp_link_failures (wa_id) values (p_wa_id);
    return jsonb_build_object('status', 'invalid');
  end if;
  delete from integrations.whatsapp_link_codes c where c.user_id = v_user;
  if not exists (select 1 from public.users u where u.id = v_user and u.is_active) then
    return jsonb_build_object('status', 'invalid');
  end if;
  if not kc_private.is_pro(v_user) then
    return jsonb_build_object('status', 'not_pro');
  end if;
  update integrations.whatsapp_identities i set user_id = null where i.user_id = v_user and i.wa_id <> p_wa_id;
  insert into integrations.whatsapp_identities as i (wa_id, user_id) values (p_wa_id, v_user)
  on conflict (wa_id) do update set user_id = excluded.user_id;
  delete from integrations.whatsapp_link_failures f where f.wa_id = p_wa_id;
  return jsonb_build_object('status', 'linked', 'user_id', v_user);
end;
$$;
comment on function public.api_whatsapp_redeem_link_code(text, text) is
  'Webhook: links the number to the member whose code it sent; locked after five failures in an hour.';

-- ── Visibility for an explicit member ───────────────────────────────────────
-- Whether p_viewer may read the post: the rules of posts_select_owner / posts_select_visible,
-- the owner's profile rules (active, no block either way) and the viewer's report hides.
create function kc_private.whatsapp_post_visible_to(p_post public.posts, p_viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_post.owner_id = p_viewer
      or (p_post.status in ('open', 'closed_delivered')
          and (p_post.visibility = 'Public'
               or (p_post.visibility = 'FollowersOnly'
                   and exists (select 1 from public.follows f
                                where f.follower_id = p_viewer and f.followed_id = p_post.owner_id)))
          and exists (select 1 from public.users u where u.id = p_post.owner_id and u.is_active)
          and not kc_access.is_blocked_between(p_viewer, p_post.owner_id)
          and not exists (select 1 from public.report_hides h
                           where h.reporter_id = p_viewer
                             and ((h.target_type = 'post' and h.target_id = p_post.id)
                                  or (h.target_type = 'user' and h.target_id = p_post.owner_id))));
$$;
comment on function kc_private.whatsapp_post_visible_to(public.posts, uuid) is
  'The posts read rules evaluated for an explicit member instead of the session.';

-- ── Agent read tools ────────────────────────────────────────────────────────
-- Open posts containing the text that the member may read, newest first (at most 8).
create function public.api_bot_search_posts(
  p_user_id uuid, p_query text, p_world_slug text default null, p_limit integer default 8)
returns table (post_id uuid, world_slug text, direction text, title text, description text,
               city_id text, published_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform kc_private.whatsapp_require_active_user(p_user_id);
  if char_length(btrim(coalesce(p_query, ''))) < 2 then
    return;
  end if;
  return query
  select p.id, p.world_slug, p.direction, p.title, p.description, p.city_id, p.published_at
    from public.posts p
   where p.id = any (kc_access.post_ids_matching_text(btrim(p_query)))
     and p.status = 'open'
     and (p_world_slug is null or p.world_slug = p_world_slug)
     and kc_private.whatsapp_post_visible_to(p, p_user_id)
   order by p.published_at desc, p.id desc
   limit least(greatest(coalesce(p_limit, 8), 1), 8);
end;
$$;
comment on function public.api_bot_search_posts(uuid, text, text, integer) is 'Agent: open posts matching a text that the member may read.';

-- Cards of the given posts, in the given order: open posts the member may read.
create function public.api_bot_post_cards(p_viewer_id uuid, p_ids uuid[])
returns table (post_id uuid, world_slug text, direction text, title text, description text,
               city_id text, published_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform kc_private.whatsapp_require_active_user(p_viewer_id);
  return query
  select p.id, p.world_slug, p.direction, p.title, p.description, p.city_id, p.published_at
    from public.posts p
   where p.id = any ((coalesce(p_ids, '{}'::uuid[]))[1:25])
     and p.status = 'open'
     and kc_private.whatsapp_post_visible_to(p, p_viewer_id)
   order by array_position(p_ids, p.id);
end;
$$;
comment on function public.api_bot_post_cards(uuid, uuid[]) is 'Agent: cards of open posts the member may read, in input order.';

-- The member's own open posts, newest first (at most 25).
create function public.api_bot_my_posts(p_user_id uuid, p_limit integer default 10)
returns table (post_id uuid, world_slug text, direction text, title text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform kc_private.whatsapp_require_active_user(p_user_id);
  return query
  select p.id, p.world_slug, p.direction, p.title, p.created_at
    from public.posts p
   where p.owner_id = p_user_id and p.status = 'open'
   order by p.created_at desc, p.id desc
   limit least(greatest(coalesce(p_limit, 10), 1), 25);
end;
$$;
comment on function public.api_bot_my_posts(uuid, integer) is 'Agent: the member''s own open posts.';

-- The member's live matches (suggested or accepted) whose other post is open and readable.
create function public.api_bot_my_matches(p_user_id uuid, p_limit integer default 10)
returns table (candidate_id uuid, world_slug text, score numeric, status text, my_post_title text,
               other_post_id uuid, other_title text, distance_km numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform kc_private.whatsapp_require_active_user(p_user_id);
  return query
  select m.id, m.world_slug, kc_private.match_effective_score(m.score, m.llm_score), m.status,
         mine.title, other.id, other.title, m.distance_km
    from kc_private.match_candidates m
    join public.posts mine
      on mine.id = case when m.offer_owner_id = p_user_id then m.offer_post_id else m.request_post_id end
    join public.posts other
      on other.id = case when m.offer_owner_id = p_user_id then m.request_post_id else m.offer_post_id end
   where p_user_id in (m.offer_owner_id, m.request_owner_id)
     and m.status in ('suggested', 'accepted')
     and other.status = 'open'
     and kc_private.whatsapp_post_visible_to(other, p_user_id)
   order by (m.status = 'accepted') desc, 3 desc, m.id
   limit least(greatest(coalesce(p_limit, 10), 1), 25);
end;
$$;
comment on function public.api_bot_my_matches(uuid, integer) is 'Agent: the member''s live matches with the other open post.';

-- ── Agent posting ───────────────────────────────────────────────────────────
-- Opens a conversation session for a number (creating its identity when new).
create function public.api_bot_open_session(p_wa_id text, p_inbound_message_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_identity uuid;
  v_id uuid;
begin
  if p_wa_id is null or btrim(p_wa_id) = '' then
    raise exception 'wa_id_required' using errcode = 'P0001';
  end if;
  insert into integrations.whatsapp_identities as i (wa_id) values (p_wa_id)
  on conflict (wa_id) do update set wa_id = i.wa_id
  returning id into v_identity;
  insert into integrations.bot_conversation_sessions (identity_id, inbound_message_id)
  values (v_identity, (select m.id from integrations.whatsapp_inbound_messages m where m.id = p_inbound_message_id))
  returning id into v_id;
  return v_id;
end;
$$;
comment on function public.api_bot_open_session(text, uuid) is 'Agent: opens a bot conversation session for a number.';

-- Stores what the model extracted as the session's draft and moves it to `confirm`. The
-- direction is give | request (or offer | request); the kind must be an active kind of the
-- world admitting it. Below 0.75 confidence the session is queued for review. Returns the
-- session id.
create function public.api_bot_apply_extraction(
  p_session_id uuid, p_world_slug text, p_kind_slug text, p_direction text, p_title text,
  p_details jsonb default '{}'::jsonb, p_confidence numeric default null, p_summary text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_direction constant text := case p_direction when 'give' then 'offer' when 'offer' then 'offer'
                                                when 'request' then 'request' end;
  v_title constant text := left(btrim(coalesce(p_title, '')), 80);
  v_session integrations.bot_conversation_sessions;
  v_kind_id uuid;
begin
  select s.* into v_session from integrations.bot_conversation_sessions s where s.id = p_session_id for update;
  if not found then
    raise exception 'session_not_found' using errcode = 'P0001';
  end if;
  if v_session.state not in ('collecting', 'confirm') then
    raise exception 'session_not_ready' using errcode = 'P0001';
  end if;
  if v_direction is null then
    raise exception 'invalid_direction' using errcode = 'P0001';
  end if;
  select k.id into v_kind_id from public.post_kinds k
   where k.world_slug = p_world_slug and k.slug = p_kind_slug and k.is_active and k.direction in (v_direction, 'either');
  if v_kind_id is null then
    raise exception 'kind_not_found' using errcode = 'P0001';
  end if;
  if v_title = '' then
    raise exception 'invalid_title' using errcode = 'P0001';
  end if;
  if p_confidence is not null and (p_confidence < 0 or p_confidence > 1) then
    raise exception 'invalid_confidence' using errcode = 'P0001';
  end if;
  update integrations.bot_conversation_sessions s
     set state = 'confirm', confidence = p_confidence,
         draft = jsonb_build_object('world_slug', p_world_slug, 'kind_slug', p_kind_slug, 'kind_id', v_kind_id,
                                    'direction', v_direction, 'title', v_title,
                                    'summary', nullif(left(btrim(coalesce(p_summary, '')), 500), ''),
                                    'details', coalesce(p_details, '{}'::jsonb))
   where s.id = p_session_id;
  if coalesce(p_confidence, 1) < 0.75 and not exists (
       select 1 from integrations.bot_review_items r where r.session_id = p_session_id and r.status = 'pending') then
    insert into integrations.bot_review_items (session_id, reason) values (p_session_id, 'low_confidence_extraction');
  end if;
  return p_session_id;
end;
$$;
comment on function public.api_bot_apply_extraction(uuid, text, text, text, text, jsonb, numeric, text) is
  'Agent: stores an extracted post draft on the session; low confidence is queued for review.';

-- Creates the post of a confirmed session for its linked owner: a native post, public, shown
-- at city level (the owner's city). It is published when the extraction's confidence is at
-- least 0.85 and the post needs no photo; otherwise it stays a draft. A low-confidence draft
-- is queued for review; an offer in a photo world (D132) waits for its photo in the app.
-- The member's post rate limit applies as to a post written in the app. Returns
-- {post_id, status, review, photo_required}.
create function public.api_bot_publish_post(p_session_id uuid, p_owner_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session integrations.bot_conversation_sessions;
  v_limit kc_private.rate_limits;
  v_city text;
  v_photo boolean;
  v_publish boolean;
  v_review boolean;
  v_post jsonb;
  v_post_id uuid;
begin
  select s.* into v_session from integrations.bot_conversation_sessions s where s.id = p_session_id for update;
  if not found then
    raise exception 'session_not_found' using errcode = 'P0001';
  end if;
  if v_session.state <> 'confirm' then
    raise exception 'session_not_ready' using errcode = 'P0001';
  end if;
  if p_owner_id is null or p_owner_id is distinct from
     (select i.user_id from integrations.whatsapp_identities i where i.id = v_session.identity_id) then
    raise exception 'owner_mismatch' using errcode = '42501';
  end if;
  perform kc_private.whatsapp_require_active_user(p_owner_id);
  select l.* into v_limit from kc_private.rate_limits l where l.action = 'post_create';
  if found and not kc_private.rate_limit('post_create:' || p_owner_id, v_limit.max_count, v_limit."window") then
    raise exception 'rate_limited' using errcode = 'P0001', detail = 'post_create';
  end if;
  select u.city_id into v_city from public.users u where u.id = p_owner_id;
  if v_city is null then
    raise exception 'city_required' using errcode = 'P0001';
  end if;

  v_photo := kc_private.offer_requires_photo(v_session.draft ->> 'world_slug', v_session.draft ->> 'direction');
  v_review := coalesce(v_session.confidence, 1) < 0.85;
  v_publish := not v_photo and not v_review;
  v_post := jsonb_build_object(
    'world_slug', v_session.draft ->> 'world_slug', 'kind_id', v_session.draft ->> 'kind_id',
    'direction', v_session.draft ->> 'direction', 'title', v_session.draft ->> 'title',
    'description', v_session.draft ->> 'summary', 'city_id', v_city, 'visibility', 'Public',
    'location_display_level', 'CityOnly');
  if v_session.draft ->> 'world_slug' = 'food' and v_session.draft ->> 'direction' = 'offer' then
    -- A food offer is created with its detail row (expiry, type) in one call.
    v_post_id := kc_private.post_create(p_owner_id, v_post, coalesce(v_session.draft -> 'details', '{}'::jsonb),
                                        case when v_publish then 'owner' end);
  else
    insert into public.posts (owner_id, world_slug, kind_id, direction, status, visibility, title, description,
                              city_id, location_display_level)
    select p_owner_id, r.world_slug, r.kind_id, r.direction, 'draft', r.visibility, r.title, r.description,
           r.city_id, r.location_display_level
      from jsonb_populate_record(null::public.posts, v_post) r
    returning id into v_post_id;
    if v_publish then
      perform kc_private.post_move(v_post_id, 'open', 'owner');
    end if;
  end if;

  insert into integrations.bot_post_origins (post_id, session_id, inbound_message_id)
  values (v_post_id, p_session_id, v_session.inbound_message_id);
  update integrations.bot_conversation_sessions s set state = 'published', post_id = v_post_id where s.id = p_session_id;
  if v_review then
    update integrations.bot_review_items r set post_id = v_post_id
     where r.session_id = p_session_id and r.status = 'pending';
    if not found then
      insert into integrations.bot_review_items (session_id, post_id, reason)
      values (p_session_id, v_post_id, 'publish_pending_review');
    end if;
  end if;
  return jsonb_build_object('post_id', v_post_id, 'status', case when v_publish then 'open' else 'draft' end,
                            'review', v_review, 'photo_required', v_photo);
end;
$$;
comment on function public.api_bot_publish_post(uuid, uuid) is
  'Agent: creates the session''s post for its linked owner; published, or a draft for review or a photo.';
