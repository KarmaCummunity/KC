-- 0402_legal_docs_dev_aligned_draft | Publish DRAFT terms + privacy on kc-dev, aligned with
-- actual behaviour: immediate in-app account deletion, donation records kept de-identified
-- (0401), current processors, report/block. Same text as public/privacy.html and terms.html.
--
-- DEV ONLY: no-op unless the kc-dev fake seed is present (>= 100 @seed.kc.test users with
-- app_metadata.seed = true), so it never publishes draft legal text on prod. Prod gets the
-- final text via publish_legal_document() after Nave / legal sign-off.
-- severity 'minor' + draft banner: dev users are not pushed through a re-acceptance gate.

do $guard$
declare
  v_seed_users int;
  v_publisher  uuid;
  v_doc        public.legal_doc_type;
  v_body       text;
  v_next       int;
begin
  select count(*) into v_seed_users
    from auth.users
   where email like '%@seed.kc.test'
     and coalesce(raw_app_meta_data->>'seed', '') = 'true';
  if v_seed_users < 100 then
    raise notice '0402: no kc-dev seed detected – skipping draft legal docs';
    return;
  end if;

  select user_id into v_publisher from public.users where is_super_admin order by created_at limit 1;
  if v_publisher is null then
    -- kc-dev has no super-admin; attribute to the first fake seed user (dev only).
    select id into v_publisher from auth.users
     where email like '%@seed.kc.test' and coalesce(raw_app_meta_data->>'seed', '') = 'true'
     order by email limit 1;
  end if;

  foreach v_doc in array array['privacy', 'terms']::public.legal_doc_type[] loop
    v_body := case v_doc
      when 'privacy' then $md$# מדיניות פרטיות

> **טיוטה — ממתינה לבדיקה משפטית.** הנוסח אינו סופי.

**1. מי אנחנו**
"קהילת קארמה" (Karma Community) מפעילה את האפליקציה והאתר. האחראי על המידע: נוה סרוסי. ליצירת קשר: karmacommunity2.0@gmail.com.

**2. איזה מידע אנחנו אוספים**
- **פרטי חשבון:** שם, אימייל, סיסמה (מוצפנת) או חשבון Google / Apple שבחרת להתחבר איתו, תמונת פרופיל, עיר שבחרת וביוגרפיה.
- **תוכן שאתם יוצרים:** פוסטים, מודעות, תמונות, תגובות, הודעות צ'אט, דיווחים וחסימות.
- **תרומות:** אם תורמים כסף — סכום, עמותה ומזהה עסקה. פרטי כרטיס האשראי מטופלים אצל ספק התשלומים ולא נשמרים אצלנו.
- **מידע טכני:** סוג מכשיר, גרסת אפליקציה, אסימון התראות, דוחות קריסה ונתוני שימוש מצטברים.
- **וואטסאפ (אם משתמשים בבוט):** מספר הטלפון והודעות ששלחתם לבוט.
איננו קוראים את המיקום המדויק של המכשיר. המיקום היחיד הוא העיר שבחרתם.

**3. למה אנחנו משתמשים במידע**
- הפעלת השירות: הצגת פוסטים ומודעות, התאמת נתינות ובקשות, צ'אט והתראות.
- בטיחות ומודרציה: טיפול בדיווחים, חסימות ומניעת ספאם והטרדה.
- שיפור השירות: סטטיסטיקות מצטברות ודוחות קריסה.
- תרגום אוטומטי של תוכן בין עברית לשפות אחרות.
איננו מוכרים מידע, איננו מציגים פרסומות ואיננו עוקבים אחריכם באפליקציות או אתרים של אחרים.

**4. עם מי המידע משותף**
- **משתמשים אחרים:** הפרופיל והתוכן הציבורי שלכם גלויים לחברי הקהילה לפי הגדרות הפרטיות.
- **ספקי שירות שמעבדים מידע עבורנו:** Supabase (מסד נתונים, התחברות, קבצים), Cloudflare (אירוח האתר), Expo (התראות), Google ו-Apple (התחברות), Google Gemini (תרגום תוכן), Meta / WhatsApp (בוט וואטסאפ), Sentry (דוחות קריסה), PostHog (סטטיסטיקות שימוש), וספק תשלומים לתרומות.
- **רשויות:** כשהחוק מחייב.

**5. העברה לחו״ל**
חלק מהספקים מאחסנים מידע מחוץ לישראל (למשל באיחוד האירופי ובארה״ב), בכפוף להסכמי עיבוד מידע.

**6. כמה זמן שומרים**
- תוכן וחשבון: כל עוד החשבון פעיל.
- מחיקת חשבון: אפשר למחוק את החשבון בכל עת בתוך האפליקציה (הגדרות ← מחק חשבון). הפרופיל, הפוסטים, המודעות, העוקבים והחסימות נמחקים מיד. הודעות ששלחתם נשארות אצל מי שדיברתם איתו, בלי השם והתמונה שלכם.
- רשומות תרומה וקבלות נשמרות ללא שיוך לחשבון ככל שהחוק מחייב שמירת רשומות חשבונאיות.

**7. הזכויות שלכם**
זכות לעיין במידע, לתקן אותו, למחוק אותו ולקבל עותק שלו. פנו אלינו בכתובת karmacommunity2.0@gmail.com. אפשר גם לפנות לרשות להגנת הפרטיות.

**8. קטינים**
השירות מיועד לבני 13 ומעלה. הורה שמבקש להסיר חשבון של ילד יכול לפנות אלינו.

**9. אבטחה**
תעבורה מוצפנת (TLS), הצפנה במנוחה אצל ספק מסד הנתונים והרשאות גישה ברמת השורה. אין אבטחה מושלמת, ונודיע על אירוע אבטחה כפי שהחוק מחייב.

**10. שינויים**
אם נשנה את המדיניות באופן מהותי נודיע באפליקציה ונבקש אישור מחדש.
$md$
      else $md$# תנאי שימוש

> **טיוטה — ממתינה לבדיקה משפטית.** הנוסח אינו סופי.

**1. השירות**
"קהילת קארמה" היא קהילה לנתינה: חפצים, אוכל, זמן, טרמפים, ידע ותרומות. השירות ניתן ללא תשלום. ליצירת קשר: karmacommunity2.0@gmail.com.

**2. הסכמה לתנאים**
השימוש באפליקציה או באתר מהווה הסכמה לתנאים אלה ולמדיניות הפרטיות.

**3. גיל**
השירות מיועד לבני 13 ומעלה.

**4. החשבון שלכם**
שמרו על סודיות פרטי ההתחברות. אסור להתחזות לאחרים או לפתוח חשבונות כפולים. אפשר למחוק את החשבון בכל עת מתוך ההגדרות.

**5. התוכן שלכם**
התוכן שלכם נשאר שלכם. אתם מעניקים לנו רישיון להציג, לאחסן ולתרגם אותו לצורך הפעלת השירות. אתם אחראים לכך שהתוכן חוקי ושיש לכם זכות לפרסם אותו.

**6. אפס סובלנות לתוכן פוגעני**
- אסור: הטרדה, בריונות, איומים, הסתה, שנאה, תוכן מיני, אלימות, ספאם, הונאה, מכירה מסחרית במסווה של נתינה, פרסום פרטים אישיים של אחרים, ופריטים אסורים או מסוכנים.
- אפשר לדווח על כל פוסט, מודעה, הודעה או משתמש, ולחסום משתמשים. נבדוק דיווחים בתוך 24 שעות, נסיר תוכן אסור ונשעה או נחסום את מי שפרסם אותו.

**7. מסירות ועסקאות בין משתמשים**
אנחנו מחברים בין אנשים ואיננו צד למסירה. בדקו פריטים לפני קבלה, היפגשו במקום בטוח, ואל תשלמו כסף עבור פריט שהוצע במתנה.

**8. תרומות כספיות**
תרומות עוברות דרך ספק תשלומים לעמותה שבחרתם. עמותות מסומנות כמאומתות אחרי בדיקה. החזרים — לפי מדיניות העמותה וספק התשלומים.

**9. השירות כמות שהוא**
השירות ניתן ״כמות שהוא״, בלי התחייבות לזמינות רציפה או לדיוק התוכן שמשתמשים מפרסמים. בכפוף לדין, איננו אחראים לנזק שנגרם משימוש בשירות או מעסקאות בין משתמשים.

**10. השעיה וסיום**
אנחנו רשאים להסיר תוכן או להשעות חשבון שמפר את התנאים. אפשר לערער דרך ״דווח על בעיה״.

**11. שינויים**
נודיע באפליקציה על שינוי מהותי בתנאים.

**12. דין ושיפוט**
על התנאים חל הדין הישראלי; סמכות השיפוט לבתי המשפט בתל אביב-יפו.
$md$
    end;

    -- Idempotent: skip if the current version already has this exact body.
    if exists (
      select 1 from public.legal_document_versions v
        join public.legal_documents d on d.doc_type = v.doc_type and d.current_version = v.version
       where v.doc_type = v_doc and v.body_md = v_body
    ) then
      continue;
    end if;

    select coalesce(max(version), 0) + 1 into v_next
      from public.legal_document_versions where doc_type = v_doc;

    insert into public.legal_document_versions (
      doc_type, version, language, effective_date, body_md, severity, change_summary, published_by
    ) values (
      v_doc, v_next, 'he', now(), v_body, 'minor', null, v_publisher
    );

    update public.legal_documents
       set current_version = v_next,
           current_effective_date = now(),
           updated_at = now()
     where doc_type = v_doc;
  end loop;
end
$guard$;
