// Public market research strings — FR-RESEARCH-001..003.
// Survey B (public web-only form) — web-only routes /research/[slug] and /research/thanks.
export const researchHe = {
  // Survey intro block (rendered above Q1, design spec §9)
  introHeading: 'לפני שאת/ה מתחיל/ה — שתי שורות.',
  introLine1: 'אנחנו בונים אפליקציה ישראלית לנתינה בחינם, בלי הבלגן של הקבוצות.',
  introLine2: '11 שאלות. אנונימי לגמרי. כמה דקות.',
  introLine3: 'כל תשובה כאן משנה איך האפליקציה תיראה בפועל. תודה.',

  // Progress
  progress: 'שאלה {{current}} מתוך {{total}}',
  progressHint: 'ניתן לנווט בחופשיות',
  questionIndex: 'שאלה {{index}}',

  // Fields
  ratingFieldLabel: 'דירוג (1–7, חובה)',
  textFieldLabel: 'פירוט (אופציונלי)',

  // Q11 contact section (last question — "שיחה איתנו")
  contactSectionTitle: 'פרטי יצירת קשר (אופציונלי)',
  contactEmailLabel: 'מייל ליצירת קשר',
  contactEmailPlaceholder: 'your@email.com',
  contactWindowLabel: 'שעה שנוחה לשיחה',
  contactWindowPlaceholder: 'לדוגמה: ימים א׳–ה׳ אחרי 18:00',

  // Floating nav on last question
  navFinish: 'סיום',

  // Submit
  submitBtn: 'שלח תשובות',
  submitting: 'שולח...',
  submitRequiresAllRatings: 'יש לדרג את כל השאלות לפני הסיום — בדקו את השאלות שסומנו',

  // Loading
  loading: 'טוען סקר...',

  // Error states (mapped from PublicResearchErrorCode)
  errorRateLimited: 'ניסית כבר היום, ננסה שוב בעוד דקה',
  errorCircuitOpen: 'השרת עמוס כרגע, נסה שוב בעוד כמה דקות',
  errorSurveyNotFound: 'הסקר הזה לא פעיל',
  errorInvalidEmail: 'כתובת המייל לא תקינה — תקנו או השאירו ריק',
  errorInvalidSource: 'קישור הסקר לא תקין — נסו שוב מהקישור המקורי',
  errorGeneric: 'אירעה שגיאה, נסה שוב',
  retryBtn: 'נסה שוב',

  // Thank-you page (design spec §9)
  thanksHeading: 'תודה. ברצינות.',
  thanksLine1: 'קראנו כל מילה — וזה משנה את מה שאנחנו בונים עכשיו.',
  thanksLine2: 'עכשיו הכי עוזר לנו שתעביר/י את הסקר לאנשים שעדיין לא שמעו על קארמה.',
  thanksSignUpLead:
    'רוצים לקבל התראות, לפרסם ולקבל כשהאפליקציה תהיה מוכנה? הצטרפו עכשיו — הסקר נשאר אנונימי.',
  thanksEmailOptInLabel: 'רוצה לראות את האפליקציה ראשון/ה כשהיא יוצאת?',
  thanksEmailPlaceholder: 'השאר/י מייל',
  thanksVisitCta: 'בקר/י באתר קארמה',

  thankYouModal: {
    title: 'תודה שעניתם על הסקר!',
    message:
      'רגע — מכירים מישהו/י שזה רלוונטי להם? ' +
      'אם מישהו/י סביבכם נותן/ת או מקבל/ת בקבוצות — שיתוף הקישור עוזר לנו לשמוע עוד קולות.',
    dismiss: 'סגור',
  },

  guestInvite: {
    kicker: 'בלי הרשמה — אפשר להמשיך',
    title: 'מחקר שוק קהילת קארמה — פתוח לכולם',
    body:
      'אפשר למלא את הסקר גם בלי חשבון. אם תרצו לקבל התראות, לפרסם ולקבל — הצטרפו לאפליקציה כשמתאים לכם.',
    signUpCta: 'הצטרפו לקארמה',
    finePrint: 'הסקר נשאר אנונימי גם אחרי הרשמה.',
  },

  // FR-RESEARCH-004 — share affordance copy for public surfaces (placements 1 + 2)
  share: {
    // Placement 1 — thank-you page primary CTA
    thanksTitle: 'שתפו את הסקר עם חבר/ה',
    thanksHelp: 'עזרו לקול שלכם להגיע גם לאחרים שעוד לא באפליקציה',
    thanksBlockTitle: 'עוד מישהו/י שצריך/ה לשמוע את זה?',
    thanksBlockBody:
      'שלחו את הקישור לחבר/ה, לקבוצה, או למי שעדיין נותן/ת בפייסבוק וואטסאפ — כל תשובה נוספת מחזקת את מה שאנחנו בונים.',

    // End-of-survey card (before submit)
    endSurveyEyebrow: 'לפני ששולחים',
    endSurveyTitle: 'רגע — מכירים מישהו/י שזה רלוונטי להם?',
    endSurveyBody:
      'אם מישהו/י סביבכם נותן/ת או מקבל/ת בקבוצות — שיתוף הקישור לוקח שנייה ועוזר לנו לשמוע עוד קולות.',
    endSurveyCta: 'שתפו את הסקר עכשיו',
    endSurveyMessage:
      'מלאתי סקר קצר של קארמה על נתינה בחינם בישראל — אנונימי, בלי הרשמה. אשמח אם גם אתם תענו:',

    // Placement 2 — small button in survey form header
    duringSurveyLabel: 'שתפו',
    duringSurveyAria: 'שתפו את הסקר עם חבר/ה',

    // Web-platform OS share-sheet title
    shareTitle: 'מחקר שוק קהילת קארמה',

    // Body of the share message — identical to in-app variant
    shareMessage:
      'אנחנו בונים אפליקציה ישראלית לנתינה בחינם, בלי הבלגן של הקבוצות. ' +
      'שאלון אנונימי קצר, בלי הרשמה — התשובות שלך משנות איך זה ייראה בפועל.',

    // Status feedback (inline status line per AC8)
    statusShared: 'הקישור שותף',
    statusCopied: 'הקישור הועתק',
    statusFailed: 'לא הצלחנו לשתף, נסה/י שוב',
  },
} as const;
