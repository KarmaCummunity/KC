-- supabase/tests/0210_content_translations_read.sql
-- Regression for migration 0210 (FR-TRANSLATE-002 Phase 1c, posts read path).
--
-- Verifies the narrow content_translations SELECT policy + get_post_translations
-- RPC: an authenticated reader sees cached translations ONLY for posts visible
-- to them, never for invisible posts (OnlyMe) or chat (message) content.
--
-- Runs as the `authenticated` role in a rolled-back transaction; ON_ERROR_STOP=1
-- means any raise fails the CI step.

begin;

-- Confirmed auth user + matching public.users row (mirrors 0199).
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
         privacy_mode = 'Public', account_status = 'active'
   where user_id = p_id;
end $$;

-- Seed owner (…a1) + reader (…b2); a public post (…c3, visible to reader) and an
-- OnlyMe post (…c4, invisible to reader). Insert translations + a chat row as
-- postgres (bypasses RLS, mirrors the service-role write path).
do $$
declare v_city text;
begin
  perform pg_temp.mk_user('00000000-0000-0000-0000-0000000209a1', 'tr209_owner');
  perform pg_temp.mk_user('00000000-0000-0000-0000-0000000209b2', 'tr209_reader');
  select city_id into v_city from public.cities limit 1;
  if v_city is null then
    raise exception 'PRECONDITION FAILED: no cities seeded';
  end if;

  insert into public.posts (post_id, owner_id, type, status, visibility,
                            title, description, category, city, street, street_number)
  values ('00000000-0000-0000-0000-0000000209c3',
          '00000000-0000-0000-0000-0000000209a1',
          'Give', 'open', 'Public', 'Public post', 'public desc', 'Other',
          v_city, 'Herzl', '1'),
         ('00000000-0000-0000-0000-0000000209c4',
          '00000000-0000-0000-0000-0000000209a1',
          'Give', 'open', 'OnlyMe', 'Private post', 'private desc', 'Other',
          v_city, 'Herzl', '2');

  -- Translations (target = 'fr'): public post title+description (should be read),
  -- private post title (must stay hidden), and a chat message row (must stay hidden).
  insert into public.content_translations
    (content_type, content_id, field, target_language, source_language, translated_text, model, confidence)
  values
    ('post', '00000000-0000-0000-0000-0000000209c3', 'title', 'fr', 'en', 'Annonce publique', 'test', 0.9),
    ('post', '00000000-0000-0000-0000-0000000209c3', 'description', 'fr', 'en', 'desc publique', 'test', 0.9),
    ('post', '00000000-0000-0000-0000-0000000209c4', 'title', 'fr', 'en', 'Annonce privée', 'test', 0.9),
    ('message', '00000000-0000-0000-0000-0000000209d5', 'body', 'fr', 'en', 'message privé', 'test', 0.9);
end $$;

-- Impersonate the reader (NOT the owner) as a plain authenticated client.
select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', '00000000-0000-0000-0000-0000000209b2', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

-- ── Direct SELECT: only the public post's 2 translation rows are visible ──────
do $$
declare v_total int; v_private int; v_message int;
begin
  select count(*) into v_total   from public.content_translations;
  select count(*) into v_private from public.content_translations
   where content_id = '00000000-0000-0000-0000-0000000209c4';
  select count(*) into v_message from public.content_translations
   where content_type = 'message';
  if v_total <> 2 then
    raise exception 'ASSERT FAILED: reader should see exactly 2 translation rows (public post title+desc), got %', v_total;
  end if;
  if v_private <> 0 then
    raise exception 'ASSERT FAILED: OnlyMe post translation must be hidden from reader, got %', v_private;
  end if;
  if v_message <> 0 then
    raise exception 'ASSERT FAILED: chat (message) translation must be hidden under the Phase 1c policy, got %', v_message;
  end if;
end $$;

-- ── RPC: returns hits for the visible post only, never the invisible one ──────
do $$
declare v_pub int; v_priv int;
begin
  select count(*) into v_pub from public.get_post_translations(
    array['00000000-0000-0000-0000-0000000209c3'::uuid,
          '00000000-0000-0000-0000-0000000209c4'::uuid], 'fr')
   where post_id = '00000000-0000-0000-0000-0000000209c3';
  select count(*) into v_priv from public.get_post_translations(
    array['00000000-0000-0000-0000-0000000209c3'::uuid,
          '00000000-0000-0000-0000-0000000209c4'::uuid], 'fr')
   where post_id = '00000000-0000-0000-0000-0000000209c4';
  if v_pub <> 2 then
    raise exception 'ASSERT FAILED: RPC should return 2 rows (title+desc) for the visible post, got %', v_pub;
  end if;
  if v_priv <> 0 then
    raise exception 'ASSERT FAILED: RPC must not return translations for the invisible post, got %', v_priv;
  end if;
end $$;

-- ── RPC: a different target language yields no rows (no cache) ────────────────
do $$
declare v_de int;
begin
  select count(*) into v_de from public.get_post_translations(
    array['00000000-0000-0000-0000-0000000209c3'::uuid], 'de');
  if v_de <> 0 then
    raise exception 'ASSERT FAILED: RPC should return 0 rows for an un-cached language, got %', v_de;
  end if;
  raise notice '✓ 0210: narrow read policy + get_post_translations RPC honor post visibility';
end $$;

reset role;
rollback;

\echo '✓ 0210 content_translations read-path RLS + RPC regression test passed'
