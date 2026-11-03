// Production survey strings — FR-SETTINGS-015..017.
// Kept separate from surveyDemo.ts (design-QA preview) per §8 naming convention.
export const surveyHe = {
  // Settings root entry row (FR-SETTINGS-015)
  entryTitle: 'סקרים וחוות דעת',

  // Hub (FR-SETTINGS-015)
  hubTitle: 'סקרים וחוות דעת',
  hubSectionTitle: 'סקרים וחוות דעת',
  freeFeedbackRow: 'חוות דעת חופשית',
  emptyState: 'אין סקרים פעילים כרגע.',

  // Status chips (FR-SETTINGS-015 AC2)
  statusNotStarted: 'לא התחיל',
  statusInProgress: 'באמצע',
  statusCompleted: 'הושלם',

  // Survey runner (FR-SETTINGS-016)
  progress: 'שאלה {{current}} מתוך {{total}}',
  progressHint: 'ניתן לחזור ולערוך',
  questionIndex: 'שאלה {{index}}',
  ratingFieldLabel: 'דירוג (1–7, חובה)',
  choiceFieldLabel: 'בחירה אחת (חובה)',
  textFieldLabel: 'פירוט (אופציונלי)',
  savingLabel: 'שומר...',
  saveErrorTitle: 'שגיאת שמירה',
  saveErrorMessage: 'לא ניתן היה לשמור את התשובות. נסו שוב.',
  loadErrorTitle: 'שגיאת טעינה',
  loadErrorMessage: 'לא ניתן היה לטעון את הסקר. נסו שוב.',

  thankYouModal: {
    title: 'תודה שעניתם על הסקר',
    message: 'התשובות נשמרו. המשוב שלכם עוזר לנו לשפר את הקהילה — אפשר לחזור ולערוך בכל עת.',
    dismiss: 'מעולה',
  },

  // Free feedback (FR-SETTINGS-017)
  feedbackRatingLow: 'לא מספיק',
  feedbackRatingHigh: 'מצוין',
  feedbackTitle: 'חוות דעת חופשית',
  feedbackBodyLabel: 'מה תרצה לשתף? (חובה)',
  feedbackBodyPlaceholder: 'שתפו מחשבות, הצעות או משוב כלשהו... (לפחות 10 תווים)',
  feedbackRatingLabel: 'דירוג כללי (אופציונלי)',
  feedbackSubmitBtn: 'שליחת חוות דעת',
  feedbackSubmitting: 'שולח...',
  feedbackSuccessToast: 'חוות הדעת נשלחה. תודה!',
  feedbackErrorTitle: 'שגיאה',
  feedbackErrorBodyTooShort: 'הטקסט חייב להכיל לפחות 10 תווים.',
  feedbackErrorBodyTooLong: 'הטקסט לא יכול לעלות על 500 תווים.',
  feedbackErrorGeneric: 'שליחה נכשלה. נסו שוב.',

  // Prompt banner (FR-SETTINGS-016 AC6)
  bannerTitle: 'יש לנו שאלה אליך',
  bannerBody: 'עזור לנו לשפר את הקהילה — כמה דקות.',
  bannerCta: 'מלא סקר',
  bannerSnooze: 'אחר כך',

  // FR-RESEARCH-004 — in-app Settings → Surveys row (placement 3)
  shareResearch: {
    rowTitle: 'שתפו את מחקר השוק עם חברים',
    rowSubtitle: 'עוזרים לנו להבין מה אנשים שלא באפליקציה צריכים — אנונימי, בלי הרשמה',
    cardShareA11y: 'שתפו את מחקר השוק',
    shareTitle: 'מחקר שוק קהילת קארמה',
    shareMessage:
      'אנחנו בונים אפליקציה ישראלית לנתינה בחינם, בלי הבלגן של הקבוצות. ' +
      'שאלון אנונימי קצר, בלי הרשמה — התשובות שלך משנות איך זה ייראה בפועל.',
    toastShared: 'הקישור שותף',
    toastCopied: 'הקישור הועתק',
    toastFailed: 'לא הצלחנו לשתף, נסה/י שוב',
  },
} as const;
