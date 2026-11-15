-- Seed starter surveys so the in-app survey prompt (slug 'ux-experience') and
-- the admin "Surveys & feedback" screen have real content. Idempotent: only
-- publishes a survey whose slug does not exist yet.
do $$
begin
  -- Fresh databases (CI, local) have no super admin to publish as; skip.
  if not exists (select 1 from public.users where is_super_admin = true) then
    return;
  end if;

  if not exists (select 1 from public.surveys where slug = 'ux-experience') then
    perform public.publish_survey_version(
      'ux-experience',
      'איך החוויה שלך בקהילת קארמה?',
      'כמה שאלות קצרות שיעזרו לנו לשפר את האפליקציה. לוקח פחות מדקה.',
      true,
      '{"min_sessions": 3}'::jsonb,
      jsonb_build_array(
        jsonb_build_object('short_label_he','קלות שימוש','prompt_he','כמה קל לך להשתמש באפליקציה?','text_placeholder_he','מה היה מסובך או לא ברור?','rating_anchor_low_he','קשה מאוד','rating_anchor_high_he','קל מאוד'),
        jsonb_build_object('short_label_he','מציאת מה שצריך','prompt_he','כמה קל למצוא פוסטים, טרמפים או עזרה שמתאימים לך?','text_placeholder_he','מה חיפשת ולא מצאת?','rating_anchor_low_he','קשה מאוד','rating_anchor_high_he','קל מאוד'),
        jsonb_build_object('short_label_he','מראה ועיצוב','prompt_he','עד כמה המסכים נראים לך ברורים ונעימים?','text_placeholder_he','איזה מסך הכי צריך שיפור?','rating_anchor_low_he','בכלל לא','rating_anchor_high_he','מאוד'),
        jsonb_build_object('short_label_he','המלצה','prompt_he','עד כמה היית ממליץ/ה על האפליקציה לחבר או חברה?','text_placeholder_he','למה?','rating_anchor_low_he','בכלל לא','rating_anchor_high_he','בהחלט')
      )
    );
  end if;

  if not exists (select 1 from public.surveys where slug = 'giving-experience') then
    perform public.publish_survey_version(
      'giving-experience',
      'נתינה וקבלה בקהילה',
      'ספר/י לנו איך היה לתת או לקבל דרך הקהילה.',
      true,
      '{"min_sessions": 5, "require_closure": true}'::jsonb,
      jsonb_build_array(
        jsonb_build_object('short_label_he','שביעות רצון','prompt_he','כמה מרוצה היית מהנתינה או הקבלה האחרונה שלך?','text_placeholder_he','מה עבד טוב ומה פחות?','rating_anchor_low_he','לא מרוצה','rating_anchor_high_he','מרוצה מאוד'),
        jsonb_build_object('short_label_he','תקשורת','prompt_he','כמה קל היה לתאם עם הצד השני?','text_placeholder_he','מה היה עוזר לתיאום?','rating_anchor_low_he','קשה מאוד','rating_anchor_high_he','קל מאוד'),
        jsonb_build_object('short_label_he','אמון ובטיחות','prompt_he','כמה בטוח/ה הרגשת במהלך התהליך?','text_placeholder_he','מה היה מחזק את התחושה?','rating_anchor_low_he','בכלל לא','rating_anchor_high_he','מאוד')
      )
    );
  end if;
end $$;
