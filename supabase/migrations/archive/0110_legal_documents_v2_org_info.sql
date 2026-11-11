-- 0110_legal_documents_v2_org_info.sql
-- Publish v2 of terms and privacy with the real legal-entity info.
--
-- v1 (seeded in 0108) used three placeholders:
--   {{LEGAL_ENTITY_NAME}}  → "קהילת קארמה" (Karma Community)
--   {{CONTACT_EMAIL}}      → karmacommunity2.0@gmail.com
--   {{CONTACT_ADDRESS}}    → individual responsible: Nave Sarussi, +972-52-861-6878
--
-- Severity is 'minor': substantive content of the documents is unchanged, only
-- entity-identifying fields were filled in. Per spec §6 / FR-SETTINGS-010 AC3,
-- minor publishes do NOT trigger the re-acknowledgement gate — existing
-- accepters of v1 stay cleared. `last_material_version` and
-- `last_material_severity` therefore remain on v1.

begin;

do $$
declare
  v_admin uuid;
begin
  select user_id
    into v_admin
    from public.users
   where is_super_admin = true
   order by created_at asc
   limit 1;

  if v_admin is null then
    raise notice 'no super-admin found; skipping v2 legal-doc seed. Prod operators must publish v2 via Supabase Studio.';
    return;
  end if;

  -- ─── Terms v2 ────────────────────────────────────────────────────────
  insert into public.legal_document_versions (
    doc_type, version, language, effective_date, body_md, severity, change_summary, published_by
  )
  values (
    'terms', 2, 'he', now(),
    $md$# תנאי שימוש

**1. מי אנחנו ומה האפליקציה**
"קהילת קארמה" (Karma Community) מפעילה את אפליקציית "קהילת קארמה" — מרחב חברתי לנתינה. האחראי על השירות מטעמנו: נוה סרוסי (יזם ומנכ"ל). ליצירת קשר: karmacommunity2.0@gmail.com · טלפון 052-861-6878.

**2. תנאי שימוש כחוזה מחייב**
עצם השימוש באפליקציה מהווה אישור לתנאים אלה.

**3. גיל מינימום (13+)**
האפליקציה מיועדת לבני 13 ומעלה. נשמור לעצמנו את הזכות להסיר חשבונות של משתמשים שמתחת לגיל.

**4. חשבון משתמש**
שמור על סודיות הסיסמה. אין להתחזות, אין לנהל יותר מחשבון אחד.

**5. תוכן שמשתמשים מעלים**
התוכן נשאר בבעלותך; אתה מעניק לנו רישיון להציג, לשמור ולהפיץ אותו כחלק מהשירות. אתה אחראי לחוקיות התוכן.

**6. שימוש אסור**
ספאם, הטעיה, הסתה, הטרדה, חשיפת פרטים אישיים של אחרים, פוסטים מסחריים, וניסיונות פריצה — אסורים.

**7. מודרציה**
אנחנו רשאים להסיר תוכן ולהשעות חשבונות לפי שיקול דעתנו. ניתן לערער דרך "דווח על בעיה".

**8. השירות As-Is**
השירות מסופק "כמות שהוא"; אין התחייבות לזמינות, לדיוק תוכן או להצלחת עסקאות. אנחנו לא צד לעסקאות בין משתמשים.

**9. הגבלת אחריות**
בכפוף לחוק, אחריותנו מוגבלת לסכום סמלי (ברירת מחדל: 0 ש"ח לשירות חינמי).

**10. שינויים בתנאים**
ייתכן שנעדכן את התנאים מעת לעת. שינוי מהותי = הודעה בתוך האפליקציה ובקשה לאישור מחודש.

**11. דין וסמכות שיפוט**
הדין הישראלי חל; סמכות שיפוט בלעדית לבתי המשפט המוסמכים בתל אביב-יפו.

**12. יצירת קשר**
נוה סרוסי (יזם ומנכ"ל) · karmacommunity2.0@gmail.com · 052-861-6878
$md$,
    'minor',
    null,
    v_admin
  )
  on conflict (doc_type, version) do nothing;

  -- ─── Privacy v2 ──────────────────────────────────────────────────────
  insert into public.legal_document_versions (
    doc_type, version, language, effective_date, body_md, severity, change_summary, published_by
  )
  values (
    'privacy', 2, 'he', now(),
    $md$# מדיניות פרטיות

**1. מי בעל הבקרה על המידע**
"קהילת קארמה" (Karma Community). האחראי על המידע מטעמנו: נוה סרוסי (יזם ומנכ"ל). ליצירת קשר: karmacommunity2.0@gmail.com · טלפון 052-861-6878.

**2. איזה מידע אנחנו אוספים**
- שמסרת: שם, עיר, ביוגרפיה, אווטר, טלפון/אימייל (לאימות), פוסטים, הודעות.
- שנאסף אוטומטית: סוג מכשיר, גרסת אפליקציה, IP, לוגים תפעוליים, אירועי הסכמה משפטיים.

**3. למה אנחנו צריכים את המידע**
תפעול השירות, אבטחה, מודרציה, תמיכה, סטטיסטיקות אגרגטיביות.

**4. הבסיס החוקי**
הסכמה; אינטרס לגיטימי (אבטחה, מניעת ספאם); חובה חוקית (תגובה לדרישת רשויות מוסמכות).

**5. שיתוף עם צדדים שלישיים (sub-processors)**
- **Supabase, Inc.** (US/EU regions) — אחסון מסד נתונים, אימות, אחסון קבצים, Realtime.
- **Google LLC / Apple Inc.** — לאימות SSO בלבד; מקבלים display name, email, avatar.
- **Expo / EAS** — לשליחת push notifications.

אין מכירת מידע. אין שימוש פרסומי. אין tracking של גורמי צד שלישי.

**6. העברה לחו"ל**
חלק מהמידע מאוחסן בשרתי Supabase מחוץ לישראל; ההעברה בכפוף ל-EU Standard Contractual Clauses.

**7. זמן שמירה**
תוכן פעיל: כל עוד החשבון פעיל. תוכן שהוסר על-ידי מודרציה: 90 יום ואז מחיקה. חשבון מחוק: 30 יום ואז מחיקה קשה.

**8. זכויותיך**
גישה, תיקון, מחיקה, ניידות (data export — JSON תוך 30 יום דרך "דווח על בעיה" → קטגוריה Privacy), ביטול הסכמה (מחיקת חשבון).

**9. קטינים (13-18)**
שירות מגיל 13. הורים שמעוניינים שחשבון של ילדם יוסר יכולים לפנות באמצעות "דווח על בעיה" → קטגוריה Privacy.

**10. אבטחה**
TLS בתעבורה, הצפנה במנוחה אצל Supabase, RLS על כל הטבלאות. אין אחריות מוחלטת.

**11. שינויים במדיניות**
שינוי מהותי = חובת אישור מחדש.

**12. תלונות וערעורים**
פנייה אלינו ב-karmacommunity2.0@gmail.com (נוה סרוסי, יזם ומנכ"ל) · טלפון 052-861-6878; זכות פנייה לרשות להגנת הפרטיות בישראל (https://www.gov.il/he/departments/the_privacy_protection_authority).
$md$,
    'minor',
    null,
    v_admin
  )
  on conflict (doc_type, version) do nothing;

  -- ─── Advance pointer rows to v2 ──────────────────────────────────────
  -- Only when v2 was actually seeded above. last_material_* deliberately
  -- stays on v1: this is a minor publish (entity-identifying fields only),
  -- so existing v1-accepters do NOT need to re-acknowledge.
  update public.legal_documents ld
     set current_version        = ldv.version,
         current_effective_date = ldv.effective_date,
         updated_at             = now()
    from public.legal_document_versions ldv
   where ldv.doc_type = ld.doc_type
     and ldv.version  = 2
     and ld.current_version < 2;
end$$;

commit;
