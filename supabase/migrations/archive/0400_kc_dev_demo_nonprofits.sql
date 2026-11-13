-- 0400_kc_dev_demo_nonprofits | #982: demo verified nonprofits so the money world is testable on kc-dev.
--
-- DEV ONLY. Inserts nothing unless the database carries the kc-dev fake seed
-- (>= 100 auth users @seed.kc.test with app_metadata.seed = true). Prod never has
-- those, so on prod (and on fresh CI stacks) this migration is a no-op.
-- Rows are clearly marked: name prefix "[DEMO]", slug prefix "demo-",
-- verification_method = 'demo_seed'. Idempotent (fixed ids, upsert on slug).
-- Same rows are also in supabase/seed/kc-dev/seed.sql so a reseed keeps them.

do $guard$
declare
  v_seed_users int;
begin
  select count(*) into v_seed_users
    from auth.users
   where email like '%@seed.kc.test'
     and coalesce(raw_app_meta_data->>'seed', '') = 'true';

  if v_seed_users < 100 then
    raise notice '0400: no kc-dev seed detected (% seed users) – skipping demo nonprofits', v_seed_users;
    return;
  end if;

  insert into public.organizations (
    org_id, name, slug, is_platform, is_verified_nonprofit, verified_at, verification_method,
    public_tagline_he, public_tagline_en, public_about_he, public_about_en
  )
  values
    ('00000000-0000-0000-0000-00000000d001'::uuid, '[DEMO] קרן לב חם', 'demo-lev-cham', false, true, now(), 'demo_seed',
     'עמותת הדגמה – סל מזון לחגים', 'Demo nonprofit – holiday food baskets',
     'עמותת הדגמה לסביבת הפיתוח בלבד. אין לתרום כסף אמיתי.', 'Demo nonprofit for the dev environment only. Do not send real money.'),
    ('00000000-0000-0000-0000-00000000d002'::uuid, '[DEMO] ידיים פתוחות', 'demo-yadayim-ptuchot', false, true, now(), 'demo_seed',
     'עמותת הדגמה – ציוד לימודי לילדים', 'Demo nonprofit – school supplies for kids',
     'עמותת הדגמה לסביבת הפיתוח בלבד. אין לתרום כסף אמיתי.', 'Demo nonprofit for the dev environment only. Do not send real money.'),
    ('00000000-0000-0000-0000-00000000d003'::uuid, '[DEMO] בית לכל חיה', 'demo-bayit-lechol-chaya', false, true, now(), 'demo_seed',
     'עמותת הדגמה – אימוץ וטיפול בבעלי חיים', 'Demo nonprofit – animal adoption and care',
     'עמותת הדגמה לסביבת הפיתוח בלבד. אין לתרום כסף אמיתי.', 'Demo nonprofit for the dev environment only. Do not send real money.')
  on conflict (slug) do update set
    is_verified_nonprofit = true,
    verification_method   = excluded.verification_method,
    public_tagline_he     = excluded.public_tagline_he,
    public_tagline_en     = excluded.public_tagline_en,
    public_about_he       = excluded.public_about_he,
    public_about_en       = excluded.public_about_en;

  raise notice '0400: demo nonprofits upserted on kc-dev';
end
$guard$;
