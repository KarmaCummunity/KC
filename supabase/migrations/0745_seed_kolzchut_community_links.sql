-- 0745_seed_kolzchut_community_links | FR-DONATE-006/007, #1993
-- Seeds verified official community links from Kol Zchut (All-Rights) and official
-- non-profit organizations to thicken thin categories (housing, knowledge, animals, money,
-- employment, food). Each URL was fetched and its page content verified on 2026-11-11;
-- each description restates only what the linked page itself states.
--
-- Ownership: rows are attributed to the first super admin. If no super admin exists yet
-- (fresh database) the migration is a no-op. The review guard forces inserts to 'pending',
-- so the seeded rows are approved immediately by the curator in this transaction.
-- Idempotent: existing (category_slug, url) pairs are skipped.

begin;

do $$
declare
  v_curator uuid;
begin
  select u.user_id into v_curator
    from public.users u
   where public.has_admin_role(u.user_id, 'super_admin')
   order by u.user_id
   limit 1;

  if v_curator is null then
    raise notice '0745: no super admin found, curated donation links not seeded';
    return;
  end if;

  create temp table curated_links (category_slug text, url text, display_name text, description text) on commit drop;

  insert into curated_links (category_slug, url, display_name, description) values
  -- housing
  ('housing', 'https://www.kolzchut.org.il/he/%D7%93%D7%99%D7%95%D7%A8_%D7%95%D7%A9%D7%99%D7%9B%D7%95%D7%9F', 'כל-זכות – דיור ושיכון', 'פורטל המרכז זכויות ושירותים בתחום הדיור בישראל: סיוע בשכר דירה, דיור ציבורי, משכנתאות, הנחות בארנונה, זכויות שוכרים וסיוע בדיור לחסרי דירה.'),
  ('housing', 'https://www.kolzchut.org.il/he/%D7%A1%D7%99%D7%95%D7%A2_%D7%91%D7%A9%D7%9B%D7%A8_%D7%93%D7%99%D7%A8%D7%94', 'כל-זכות – סיוע בשכר דירה', 'משרד הבינוי והשיכון מעניק סיוע כספי בשכר דירה לזכאים מקבוצות שונות (עולים, חסרי דירה, משפחות שבראשן הורה עצמאי ומקבלי קצבאות קיום).'),
  ('housing', 'https://www.kolzchut.org.il/he/%D7%93%D7%99%D7%95%D7%A8_%D7%A6%D7%99%D7%91%D7%95%D7%A8%D7%99', 'כל-זכות – דיור ציבורי', 'דיור בשכירות מסובסדת מטעם משרד הבינוי והשיכון ומשרד העלייה והקליטה לחסרי דירה העומדים בכללי הזכאות, באמצעות חברות מאכלסות ציבוריות.'),
  ('housing', 'https://shanti.org.il/', 'בית השנטי – בית חם לנוער בסיכון', 'בית לנוער בסיכון ולנערים ונערות במצוקה המעניק קבלה, ביטחון, מקום חם ועתיד חדש, ללא תנאים וללא שיפוט.'),
  ('housing', 'https://echpat.org.il/', 'עמותת אכפת – למען דרי רחוב', 'עמותה המפעילה מיזמי שיכון ודירות קהילתיות מאובזרות למחוסרי דיור ומכורים נקיים, ופועלת לשיקומם, קידומם ושילובם בחברה.'),
  -- money
  ('money', 'https://www.kolzchut.org.il/he/%D7%94%D7%9B%D7%A0%D7%A1%D7%94_%D7%A0%D7%9E%D7%95%D7%9B%D7%94_%D7%95%D7%A7%D7%A9%D7%99%D7%99%D7%9D_%D7%9B%D7%9C%D7%9B%D7%9C%D7%99%D7%99%D7%9D', 'כל-זכות – הכנסה נמוכה וקשיים כלכליים', 'פורטל זכויות למשפחות ויחידים בעלי הכנסה נמוכה: גמלאות קיום, סיוע בהוצאה לפועל וחובות, שכר מצווה וסיוע משפטי, והנחות בחשבונות.'),
  ('money', 'https://www.kolzchut.org.il/he/%D7%92%D7%9E%D7%9C%D7%AA_%D7%94%D7%91%D7%98%D7%97%D7%AA_%D7%94%D7%9B%D7%A0%D7%A1%D7%94', 'כל-זכות – גמלת הבטחת הכנסה (השלמת הכנסה)', 'גמלה של המוסד לביטוח לאומי המבטיחה הכנסה בסיסית למי שאינם מסוגלים להבטיח הכנסה מעבודה או שהכנסתם נמוכה מרמת המינימום.'),
  ('money', 'https://www.naomi.org.il/', 'חסדי נעמי – עמותה לנזקקים וניצולי שואה', 'עמותה התומכת כספית באלפי משפחות נזקקות, אלמנות ויתומים וניצולי שואה, ומחלקת סלי מזון במוקדים ברחבי הארץ.'),
  -- employment
  ('employment', 'https://www.kolzchut.org.il/he/%D7%AA%D7%A2%D7%A1%D7%95%D7%A7%D7%94_%D7%95%D7%96%D7%9B%D7%95%D7%99%D7%95%D7%AA_%D7%A2%D7%95%D7%91%D7%93%D7%99%D7%9D', 'כל-זכות – תעסוקה וזכויות עובדים', 'פורטל המרכז את זכויות העובדים בישראל: קבלה לעבודה, שכר ותנאים סוציאליים, ימי חופשה ומחלה, שוויון הזדמנויות וסיום יחסי עבודה.'),
  ('employment', 'https://www.kolzchut.org.il/he/%D7%93%D7%9E%D7%99_%D7%90%D7%91%D7%98%D7%9C%D7%94', 'כל-זכות – דמי אבטלה', 'קצבה חודשית המשולמת על ידי המוסד לביטוח לאומי למי שנפלטו ממעגל העבודה ועונים על תנאי הזכאות, כדי להבטיח אמצעי קיום בתקופת האבטלה.'),
  ('employment', 'https://www.kolzchut.org.il/he/%D7%A9%D7%9B%D7%A8_%D7%9E%D7%99%D7%A0%D7%99%D7%9E%D7%95%D7%9D', 'כל-זכות – שכר מינימום', 'מידע מקיף על שכר המינימום החוקי בישראל, עדכוני סכומים לפי שכר חודשי, שכר יומי ושכר לפי שעה, וזכויות העובדים לאכיפתו.'),
  ('employment', 'https://www.kavlaoved.org.il/', 'קו לעובד – הגנה על זכויות עובדים', 'עמותה ללא מטרות רווח המסייעת לעובדים מוחלשים בישראל במימוש זכויותיהם: עובדים בשכר נמוך, מהגרי עבודה, עובדי קבלן ומבקשי מקלט.'),
  -- knowledge
  ('knowledge', 'https://www.kolzchut.org.il/he/%D7%A1%D7%98%D7%95%D7%93%D7%A0%D7%98%D7%99%D7%9D', 'כל-זכות – סטודנטים', 'פורטל זכויות והטבות לסטודנטים במוסדות להשכלה גבוהה: מלגות לימודים, הקלות במבחנים, זכויות משרתי מילואים והנחות בתחבורה ציבורית.'),
  ('knowledge', 'https://www.kolzchut.org.il/he/%D7%94%D7%9B%D7%A9%D7%A8%D7%94_%D7%9E%D7%A7%D7%A6%D7%95%D7%A2%D7%99%D7%AA', 'כל-זכות – הכשרה מקצועית ושילוב בתעסוקה', 'תוכניות הכשרה מקצועית ושוברי הכשרה מטעם משרד העבודה ולשכות התעסוקה לשיפור יכולת ההשתכרות והשתלבות בשוק העבודה.'),
  ('knowledge', 'https://www.kolzchut.org.il/he/%D7%97%D7%99%D7%A0%D7%95%D7%9A', 'כל-זכות – חינוך והשכלה', 'פורטל זכויות במערכת החינוך: השלמת השכלה, תוכניות חינוך מיוחד, זכויות תלמידים והורים, תשלומי הורים והכנה לבחינות בחינם.'),
  ('knowledge', 'https://www.snunit.k12.il/', 'סנונית – קידום החינוך המקוון', 'עמותה המפתחת תוכן חינוכי דיגיטלי, משחקים, אתרים ואפליקציות במגוון נושאים להעשרת חוויית הלמידה של מורים ותלמידים.'),
  ('knowledge', 'https://www.cet.ac.il/', 'מט״ח – המרכז לטכנולוגיה חינוכית', 'מוסד ללא כוונת רווח הפועל לקידום מערכת החינוך בישראל באמצעות פיתוח תוכניות לימודים, סביבות למידה דיגיטליות וחומרי הדרכה מותאמים אישית.'),
  -- animals
  ('animals', 'https://www.yad4.co.il/', 'יד 4 – מאגר אימוץ כלבים וחתולים ארצי', 'מאגר אימוץ ארצי המרכז עשרות עמותות, כלביות והסגרים עירוניים למציאת בית חם לכלבים וחתולים נטושים ברחבי הארץ.'),
  ('animals', 'https://www.freedom-farm.org.il/', 'חוות החופש', 'מיזם חינוכי ומקום מקלט לבעלי חיים שניצלו מתעשיות המזון, הפועל לשינוי תודעתי והגנה על זכויות בעלי החיים לחיי חופש.'),
  ('animals', 'https://www.petprotect.org.il/', 'צער בעלי חיים חיפה', 'ארגון מתנדבים עצמאי ואחת מעמותות בעלי החיים הוותיקות בארץ, המפעיל בית מחסה ומרפאה ומטפל באימוץ כלבים וחתולים באזור הצפון.'),
  ('animals', 'https://www.israelguidedog.org.il/', 'המרכז הישראלי לכלבי נחייה', 'עמותה המכשירה כלבי נחייה ומעניקה אותם ללא תשלום לעיוורים ולקויי ראייה כדי לאפשר להם עצמאות, ניידות מלאה וביטחון עצמי.'),
  -- food
  ('food', 'https://www.jlmfoodrescuers.org/', 'מצילות המזון – ירושלים', 'תנועה קהילתית הפועלת בירושלים לצמצום בזבוז מזון, הצלת עודפי תוצרת חקלאית והגברת הביטחון התזונתי דרך שווקים קהילתיים והתנדבות.');

  insert into public.donation_links (category_slug, url, display_name, description, submitted_by, validated_at)
  select c.category_slug, c.url, c.display_name, c.description, v_curator, now()
    from curated_links c
   where not exists (
     select 1 from public.donation_links l
      where l.category_slug = c.category_slug and l.url = c.url
   );

  -- Approve only the rows this migration just created (validated_at = this transaction's now()).
  update public.donation_links l
     set review_status = 'approved', reviewed_by = v_curator, reviewed_at = now()
    from curated_links c
   where l.category_slug = c.category_slug
     and l.url = c.url
     and l.submitted_by = v_curator
     and l.validated_at = now()
     and l.review_status = 'pending';
end
$$;

commit;
