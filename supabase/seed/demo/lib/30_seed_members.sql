-- Demo data (FR-ADMIN-031) · restore phase "members": 200 Hebrew-named demo members.
--
-- Each member is created the way the auth service creates one (an auth account with a
-- confirmed email and its email identity); the baseline trigger builds the member rows and
-- the confirmed email makes the account active. Values are picked by position, not at
-- random, so every restore produces the same people.

-- Number of demo members a restore creates; the content phases size themselves from it.
create or replace function kc_private.demo_member_count()
returns integer
language sql
immutable
set search_path = ''
as $$ select 200; $$;

create or replace function kc_private.demo_seed_members(p_password_hash text)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_first constant text[] := array['נועה','יעל','תמר','מאיה','שירה','רוני','אביגיל','הדר','ליה','מיכל',
    'דנה','אורית','רחל','שרה','אסתר','יוסי','דוד','משה','איתי','עומר','יונתן','אורי','נדב','אריאל',
    'עידו','אלון','גיא','רועי','אמיר','מוחמד','אחמד','סלים','לילא','נור','ויקטוריה','אלכסנדר','דימה',
    'אולגה','בנימין','חנה'];
  v_last constant text[] := array['כהן','לוי','מזרחי','פרץ','ביטון','אברהם','פרידמן','שפירא','אזולאי',
    'דהן','חדד','אוחיון','גבאי','קפלן','רוזן','בן דוד','סלאמה','חורי','נסר','איבנוב','גולן','שלום',
    'עמר','יוסף','בירנבאום'];
  v_bio constant text[] := array['אוהב/ת לעזור לשכנים','אמא לשלושה, מוסרת הרבה בגדי ילדים',
    'סטודנט/ית, מחפש/ת ריהוט לדירה','מתנדב/ת בבנק המזון','נהג/ת קבוע/ה לירושלים',
    'גמלאי/ת עם הרבה זמן פנוי'];
  v_cities constant text[] := kc_private.demo_city_pool();
  v_count constant integer := kc_private.demo_member_count();
  v_created integer;
begin
  if coalesce(p_password_hash, '') = '' then
    raise exception 'password_required' using errcode = 'P0001';
  end if;
  if cardinality(v_cities) = 0 then
    raise exception 'reference_data_missing' using errcode = 'P0001', detail = 'no cities to place members in';
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change)
  select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
         'demo' || g || '@seed.kc.test', p_password_hash, now(),
         jsonb_build_object('provider', 'email', 'providers', array['email'], 'seed', true, 'demo', true),
         jsonb_build_object('full_name',
           v_first[1 + (g * 7) % cardinality(v_first)] || ' ' || v_last[1 + (g * 11) % cardinality(v_last)],
           'seed', true, 'demo', true),
         now() - make_interval(days => g % 200), now(), '', '', '', ''
    from generate_series(1, v_count) g
   where not exists (select 1 from auth.users u where u.email = 'demo' || g || '@seed.kc.test');
  get diagnostics v_created = row_count;

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  select gen_random_uuid(), u.id, u.id::text,
         jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
         'email', now(), now(), now()
    from auth.users u
   where u.id = any (kc_private.demo_member_ids())
     and not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email');

  -- Profile: name, a city, a short bio for most; one in seven private; verification levels
  -- 0–2 spread evenly (the identity matrix the worlds gate on).
  update public.users p
     set display_name = left(m.full_name, 50),
         city_id = v_cities[1 + (m.n * 13) % cardinality(v_cities)],
         biography = case when m.n % 7 = 0 then null else v_bio[1 + m.n % cardinality(v_bio)] end,
         privacy_mode = case when m.n % 7 = 3 then 'Private' else 'Public' end,
         verification_level = m.n % 3,
         preferred_language = 'he'
    from (select u.id, u.raw_user_meta_data ->> 'full_name' as full_name,
                 substring(u.email from '^demo([0-9]+)@')::integer as n
            from auth.users u where u.id = any (kc_private.demo_member_ids())) m
   where p.id = m.id;

  update public.user_account a
     set onboarding_state = 'completed'
   where a.user_id = any (kc_private.demo_member_ids()) and a.onboarding_state <> 'completed';

  -- Every member accepted the legal documents in force; every third one is a declared driver,
  -- so ride offers can be published in their name.
  insert into public.user_consents (user_id, consent_kind, version, locale)
  select m.id, d.doc_type, d.current_version, 'he'
    from unnest(kc_private.demo_member_ids()) m (id)
   cross join public.legal_documents d
   where d.current_version > 0
  on conflict (user_id, consent_kind, version) do nothing;

  insert into public.user_consents (user_id, consent_kind, version, locale)
  select m.id, 'driver_declaration', kc_private.world_consent_version('driver_declaration'), 'he'
    from unnest(kc_private.demo_member_ids()) with ordinality m (id, n)
   where m.n % 3 = 0
  on conflict (user_id, consent_kind, version) do nothing;

  return v_created;
end;
$$;
comment on function kc_private.demo_seed_members(text) is
  'Demo restore phase "members": creates the demo members with the given bcrypt password hash.';

-- Declared drivers among the demo members (ride offers are published in their name).
create or replace function kc_private.demo_driver_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(c.user_id order by c.user_id), '{}')
    from public.user_consents c
   where c.user_id = any (kc_private.demo_member_ids())
     and c.consent_kind = 'driver_declaration';
$$;
