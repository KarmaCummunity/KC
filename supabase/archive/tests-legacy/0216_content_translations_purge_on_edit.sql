-- supabase/tests/0216_content_translations_purge_on_edit.sql
-- Regression for migration 0216 (FR-TRANSLATE-003: purge cached post translations
-- when title or description is edited).
--
-- Verifies that:
--   1. A non-content update (reopen_count bump) does NOT purge cached translations.
--   2. A title edit DOES purge all cached translations for that post.
--
-- Runs as postgres (bypasses RLS) in a rolled-back transaction;
-- ON_ERROR_STOP=1 means any raise fails the CI step.

begin;

-- Helper: create a confirmed auth user + matching public.users row (mirrors 0210).
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

-- Seed one owner + one post with two cached translations (title + description).
do $$
declare v_city text;
begin
  perform pg_temp.mk_user('00000000-0000-0000-0000-0000002160b1', 'tr214_owner');
  select city_id into v_city from public.cities limit 1;
  if v_city is null then
    raise exception 'PRECONDITION FAILED: no cities seeded';
  end if;

  insert into public.posts (post_id, owner_id, type, status, visibility,
                            title, description, category, city, street, street_number)
  values ('00000000-0000-0000-0000-0000002160c1',
          '00000000-0000-0000-0000-0000002160b1',
          'Give', 'open', 'Public', 'Original title', 'Original description', 'Other',
          v_city, 'Herzl', '1');

  insert into public.content_translations
    (content_type, content_id, field, target_language, source_language, translated_text, model, confidence)
  values
    ('post', '00000000-0000-0000-0000-0000002160c1', 'title',       'fr', 'en', 'Titre original',       'test', 0.9),
    ('post', '00000000-0000-0000-0000-0000002160c1', 'description', 'fr', 'en', 'Description originale', 'test', 0.9);
end $$;

-- ── Assert: non-content update does NOT purge translations ────────────────────
do $$
declare v_count int;
begin
  update public.posts
     set reopen_count = reopen_count + 1
   where post_id = '00000000-0000-0000-0000-0000002160c1';

  select count(*) into v_count
    from public.content_translations
   where content_type = 'post'
     and content_id = '00000000-0000-0000-0000-0000002160c1';

  if v_count <> 2 then
    raise exception 'ASSERT FAILED: non-content update must NOT purge translations; expected 2 rows, got %', v_count;
  end if;
end $$;

-- ── Assert: title edit DOES purge all cached translations for the post ────────
do $$
declare v_count int;
begin
  update public.posts
     set title = 'New title'
   where post_id = '00000000-0000-0000-0000-0000002160c1';

  select count(*) into v_count
    from public.content_translations
   where content_type = 'post'
     and content_id = '00000000-0000-0000-0000-0000002160c1';

  if v_count <> 0 then
    raise exception 'ASSERT FAILED: title edit must purge all cached translations; expected 0 rows, got %', v_count;
  end if;
end $$;

rollback;

\echo '✓ 0216 content_translations purge-on-edit regression test passed'
