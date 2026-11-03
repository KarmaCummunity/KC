// app/apps/mobile/src/i18n/locales/he/modules/adminSurveys.ts
// FR-ADMIN-021 — Admin Portal survey results & free-feedback dashboard.
export const adminSurveysHe = {
  title: 'סקרים וחוות דעת',
  subtitle: 'סטטיסטיקות ותשובות פר משתמש',
  loading: 'טוען...',
  forbiddenTitle: 'אין לך הרשאת גישה לנתוני הסקרים.',
  errorTitle: 'אירעה שגיאה בטעינת הנתונים.',
  retry: 'נסו שוב',

  tabs: {
    surveys: 'סקרים',
    feedback: 'חוות דעת חופשיות',
  },

  overview: {
    emptyTitle: 'אין סקרים פעילים',
    emptyHint: 'סקרים שפורסמו יופיעו כאן עם נתוני המענה.',
    respondents: (n: number) => `${n} משיבים`,
    responses: (n: number) => `${n} תשובות`,
    questions: (n: number) => `${n} שאלות`,
    inactiveBadge: 'לא פעיל',
    lastResponse: (when: string) => `מענה אחרון: ${when}`,
    noResponses: 'אין מענה עדיין',
    versionLabel: (v: number) => `גרסה ${v}`,
  },

  stats: {
    sectionTitle: 'סטטיסטיקות לפי שאלה',
    avgLabel: 'ממוצע',
    responsesLabel: 'תשובות',
    noData: 'אין נתונים',
    choiceDistributionTitle: 'התפלגות בחירות',
    distributionTitle: 'התפלגות דירוגים (1–7)',
  },

  respondents: {
    sectionTitle: 'תשובות פר משתמש',
    emptyTitle: 'אין תשובות עדיין',
    anonymous: 'משתמש ללא שם',
    submittedAt: (when: string) => `הוגש ${when}`,
    ratingLabel: (n: number) => `דירוג: ${n}/7`,
    noText: '(ללא הערה)',
  },

  feedback: {
    sectionTitle: 'חוות דעת חופשיות',
    emptyTitle: 'אין חוות דעת עדיין',
    emptyHint: 'חוות דעת חופשיות שמשתמשים שלחו יופיעו כאן.',
    anonymous: 'משתמש ללא שם',
    ratingLabel: (n: number) => `דירוג: ${n}/7`,
    noRating: 'ללא דירוג',
  },

  // KC#1058 — Sean Ellis product/market-fit score (survey pmf-sean-ellis).
  pmf: {
    sectionTitle: 'מדד התאמה לשוק (Sean Ellis)',
    scoreCaption: 'ענו "מאוד מאוכזב/ת"',
    marginOfError: (pct: string) => `±${pct} (רווח סמך 95%)`,
    benchmark: 'יעד: 40% ומעלה',
    aboveBenchmark: 'מעל היעד',
    belowBenchmark: 'מתחת ליעד',
    sample: (n: number, total: number) => `n = ${n} משיבים פעילים (מתוך ${total} שענו)`,
    qualifiedHint: (days: number) =>
      `נספרים רק משיבים שנכנסו לאפליקציה ב-${days} ימים לפחות ב-14 הימים שלפני המענה.`,
    smallSample: (min: number) => `פחות מ-${min} תשובות — התוצאה עדיין לא יציבה.`,
    optionShare: (pct: string, count: number) => `${pct} · ${count}`,
    retention: (pct: string, retained: number, base: number) => `חזרו אחרי שבוע: ${pct} (${retained}/${base})`,
    retentionPending: 'חזרו אחרי שבוע: עוד אין נתונים',
    retentionHint: 'שימור: מי שענה לפני 7 ימים ומעלה ונכנס שוב 7 ימים או יותר אחרי המענה.',
    emptyTitle: 'אין עדיין תשובות של משיבים פעילים.',
    errorTitle: 'לא ניתן לטעון את מדד ההתאמה.',
  },

  backToList: 'חזרה לרשימת הסקרים',
} as const;
