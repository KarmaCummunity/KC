-- supabase/tests/0415_realtime_polish.sql | 0415–0416: client send auth (typing / presence),
-- online presence topic, feed:public new-post broadcast.

begin;

create or replace function pg_temp.mk_user(p_id uuid, p_handle text)
returns void language plpgsql as $$
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, aud, role)
  values (p_id, p_handle || '@test.local', now(),
          jsonb_build_object('full_name', 'Display ' || p_handle),
          jsonb_build_object('provider', 'email'),
          'authenticated', 'authenticated');
  update public.users
     set share_handle = p_handle, display_name = 'Display ' || p_handle,
         account_status = 'active', privacy_mode = 'Public', onboarding_state = 'completed'
   where user_id = p_id;
end $$;

-- ── static shape ─────────────────────────────────────────────────────────────
do $$
declare
  v_name text;
begin
  foreach v_name in array array['chat_realtime_client_send', 'online_presence_track'] loop
    if not exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages'
                     and policyname = v_name and cmd = 'INSERT') then
      raise exception 'ASSERT FAILED: realtime.messages INSERT policy % missing', v_name;
    end if;
  end loop;
  foreach v_name in array array['online_presence_receive', 'feed_public_broadcast_receive', 'chat_realtime_broadcast_receive'] loop
    if not exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages'
                     and policyname = v_name and cmd = 'SELECT') then
      raise exception 'ASSERT FAILED: realtime.messages SELECT policy % missing', v_name;
    end if;
  end loop;
  if not exists (select 1 from pg_trigger where tgname = 'tg_posts_feed_new_post_broadcast'
                   and tgrelid = 'public.posts'::regclass and not tgisinternal) then
    raise exception 'ASSERT FAILED: feed new-post broadcast trigger missing';
  end if;
  -- messages must stay off the publication (0349); delivery is Broadcast.
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
               and schemaname = 'public' and tablename in ('messages', 'posts')) then
    raise exception 'ASSERT FAILED: messages/posts must not be on supabase_realtime';
  end if;
end $$;

-- ── topic parser never raises ────────────────────────────────────────────────
do $$
begin
  if public.realtime_topic_uuid('chat:00000000-0000-0000-0000-000000415c01:typing')
       is distinct from '00000000-0000-0000-0000-000000415c01'::uuid then
    raise exception 'ASSERT FAILED: realtime_topic_uuid did not parse a chat topic';
  end if;
  if public.realtime_topic_uuid('chat:not-a-uuid:typing') is not null
     or public.realtime_topic_uuid('presence:online') is not null
     or public.realtime_topic_uuid(null) is not null then
    raise exception 'ASSERT FAILED: realtime_topic_uuid must return null on malformed topics';
  end if;
end $$;

-- ── fixtures ────────────────────────────────────────────────────────────────
do $$
begin
  perform pg_temp.mk_user('00000000-0000-0000-0000-000000415a01', 'rt_alice');
  perform pg_temp.mk_user('00000000-0000-0000-0000-000000415b02', 'rt_bob');
  perform pg_temp.mk_user('00000000-0000-0000-0000-000000415e03', 'rt_eve');
  insert into public.chats (chat_id, participant_a, participant_b)
  values ('00000000-0000-0000-0000-000000415c01',
          '00000000-0000-0000-0000-000000415a01', '00000000-0000-0000-0000-000000415b02');
end $$;

-- ── publishing a Public post still succeeds with the broadcast trigger ──────
do $$
declare
  v_post uuid;
begin
  insert into public.posts (owner_id, type, title, status, visibility,
                            city, street, street_number, location_display_level, category)
  values ('00000000-0000-0000-0000-000000415a01', 'Give', 'realtime banner post', 'open', 'Public',
          'tel-aviv', 'Test', '1', 'CityOnly', 'Other')
  returning post_id into v_post;
  if v_post is null then
    raise exception 'ASSERT FAILED: post insert with broadcast trigger returned no id';
  end if;
end $$;

-- ── Realtime Authorization: participant may send typing, stranger may not ───
-- Runs only where the local stack grants INSERT on realtime.messages and has today's partition.
create or replace function pg_temp.try_send(p_user uuid, p_topic text, p_extension text)
returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('realtime.topic', p_topic, true);
  set local role authenticated;
  begin
    insert into realtime.messages (topic, extension, event, payload, private)
    values (p_topic, p_extension, 'typing', '{}'::jsonb, true);
    reset role;
    return 'allowed';
  exception
    when insufficient_privilege then
      reset role;
      return case when sqlerrm ilike '%row-level security%' then 'denied' else 'no_grant' end;
    when others then
      reset role;
      return 'skip:' || sqlstate;
  end;
end $$;

do $$
declare
  v_topic text := 'chat:00000000-0000-0000-0000-000000415c01:typing';
  v_res text;
begin
  v_res := pg_temp.try_send('00000000-0000-0000-0000-000000415a01', v_topic, 'broadcast');
  if v_res in ('no_grant') or v_res like 'skip:%' then
    raise notice 'skipping realtime send auth checks (%).', v_res;
    return;
  end if;
  if v_res <> 'allowed' then
    raise exception 'ASSERT FAILED: participant typing send was %', v_res;
  end if;
  v_res := pg_temp.try_send('00000000-0000-0000-0000-000000415e03', v_topic, 'broadcast');
  if v_res <> 'denied' then
    raise exception 'ASSERT FAILED: non-participant typing send was %', v_res;
  end if;
  v_res := pg_temp.try_send('00000000-0000-0000-0000-000000415e03', 'presence:online', 'presence');
  if v_res <> 'allowed' then
    raise exception 'ASSERT FAILED: active member presence track was %', v_res;
  end if;
  v_res := pg_temp.try_send('00000000-0000-0000-0000-000000415e03', 'presence:online', 'broadcast');
  if v_res <> 'denied' then
    raise exception 'ASSERT FAILED: broadcast on presence:online was %', v_res;
  end if;
end $$;

rollback;

\echo '✓ 0415_realtime_polish.sql passed'
