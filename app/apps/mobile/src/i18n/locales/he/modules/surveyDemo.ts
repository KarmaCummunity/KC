// Survey UX-demo strings — internal preview, not loaded from the server.
// Mapped to: docs/SSOT/spec/11_settings.md "survey demo" entry.
export const surveyDemoHe = {
  entryTitle: 'סקרים (דמה)',
  entryLabel: 'סקר חווית משתמש — תצוגה לדוגמה',
  screenTitle: 'סקר חווית משתמש (דמה)',
  progress: 'שאלה {{current}} מתוך {{total}}',
  progressHint: 'דמה · ללא שמירה',
  questionIndex: 'שאלה {{index}}',
  ratingFieldLabel: 'דירוג (1–7, חובה)',
  ratingLowHint: '1 = לא מספיק',
  ratingHighHint: '7 = מצוין',
  textFieldLabel: 'פירוט (אופציונלי)',
  questionMapTitle: 'כל השאלות',
  navPrev: 'הקודם',
  navNext: 'הבא',
  navPrevA11y: 'שאלה קודמת',
  navNextA11y: 'שאלה הבאה',
  ratingCellA11y: 'דירוג {{value}}',
  questionA11y: 'שאלה {{index}}, {{label}}',
  questions: {
    q1: {
      shortLabel: 'אנונימיות',
      prompt:
        'מה דעתך על מנגנון האנונימיות? האם אתה מרגיש שהוא מספק את צריכיך?',
      context:
        'אנחנו רוצים לוודא שאפשר לבקש או לתת עזרה בלי חשיפה מיותרת. דרג לפי התחושה האמיתית שלך — לא לפי מה ש"אמור" להיות.',
      textPlaceholder:
        'לדוגמה: מה עוזר לך להרגיש בטוח, ומה עדיין מרגיש חשוף מדי?',
    },
    q2: {
      shortLabel: 'פרסום פוסטים',
      prompt: 'עד כמה קל וברור לפרסם בקשה או נתינה באפליקציה?',
      context:
        'חשוב על השלבים מהרעיון ועד לפרסום: בחירת סוג, תמונה, מיקום והגדרות פרטיות. אם נתקעת באמצע — זה בדיוק מה שאנחנו רוצים לשמוע.',
      textPlaceholder: 'איזה שלב היה הכי מבלבל או הכי חסר?',
    },
    q3: {
      shortLabel: 'פיד וחיפוש',
      prompt: 'איך חווית הפיד והחיפוש? האם מוצא בקלות מה שמחפשים?',
      context:
        'הפיד אמור לחבר אנשים לעזרה רלוונטית. חפש/י משהו שמעניין אותך וחשוב/י אם הסינון, המרחק והמיון עזרו לך.',
      textPlaceholder: 'מה חיפשת ומה היה חסר בתוצאות?',
    },
    q4: {
      shortLabel: 'התראות',
      prompt: 'האם ההתראות רלוונטיות ולא מציפות? מה היית משנה?',
      context:
        'התראות אמורות לעזור בזמן אמת — לא להציף. חשוב/י על התראות קריטיות (סגירה, צ׳אט) לעומת חברתיות.',
      textPlaceholder: 'אילו התראות היית מוריד או מוסיף?',
    },
    q5: {
      shortLabel: 'המלצה כללית',
      prompt: 'עד כמה היית ממליץ על קארמה לחבר? מה הכי חשוב לשפר?',
      context:
        'זו שאלת סיכום: דירוג גבוה לא אומר שהכל מושלם, ודירוג נמוך לא אומר שלא אהבת. שתף/י במילה אחת מה הכי ישפר את החוויה.',
      textPlaceholder: 'מה הדבר הראשון שהיית משפר/ה בקארמה?',
    },
  },
} as const;
