// Onboarding screens — FR-AUTH-010..012, FR-AUTH-018. Consumed by
// `(onboarding)/about-intro`, `basic-info`, `photo`, `tour`, plus the shared
// `OnboardingStepHeader` and the basic-info / photo flow hooks.
// Extracted from the root `index.ts` during the PR5a i18n sweep to keep the
// composition file under the 200-LOC architecture cap.
export const onboardingHe = {
  aboutIntroTitle: 'ברוכים הבאים לקארמה',
  aboutIntroBody:
    'מחברים בין מי שרוצה לתת, למי שצריך לקבל. פשוט, חברי, וחינמי לחלוטין.',
  aboutIntroCta: 'מתחילים',
  pillarFree: 'חינמי לחלוטין',
  pillarNoAds: 'בלי פרסומות',
  pillarNonProfit: 'ללא רווחים',
  stepBasic: 'פרטים בסיסיים',
  basicInfoSubtitle:
    ' יש לוודא את השם ולמלא את הכתובת — כדי שנוכל להתאים פוסטים אליך. אפשר להשלים גם בהמשך.',
  displayName: 'שם מלא',
  city: 'עיר מגורים',
  contactPhoneLabel: 'טלפון ליצירת קשר (אופציונלי)',
  contactPhonePlaceholder: 'לדוגמה: 050-1234567',
  stepPhoto: 'תמונת פרופיל',
  uploadPhoto: 'העלאת תמונה',
  skip: 'דלג',
  continue: 'המשך',
  stepWelcome: 'ברוכים הבאים לקהילה!',
  welcomeDesc: 'כאן תוכל לתת ולקבל חפצים בחינם מוחלט — ללא כסף, ללא חליפין.',
  howItWorks: 'איך זה עובד?',
  step1Title: 'לפרסם מה יש לתת',
  step1Desc: 'תמונה + כמה מילים — וזהו.',
  step2Title: 'לבקש את מה שצריך',
  step2Desc: 'מפרסמים בקשה ומישהו מהקהילה יענה.',
  step3Title: 'תאם מסירה',
  step3Desc: 'שוחח ישירות עם הנותן/מקבל.',
  letsGo: 'יאללה, מתחילים!',
  stepProgress: 'שלב {{step}} מתוך 4',
  noActiveSession: 'אין סשן פעיל. אפשר להתחבר שוב.',
  fillNameAndCity: 'יש למלא שם ועיר',
  saveFailed: 'שמירה נכשלה',
  uploadFailed: 'העלאת התמונה נכשלה',
  uploadFailedBody: 'אפשר לדלג ולהוסיף תמונה מאוחר יותר.',
  removeFailed: 'הסרת התמונה נכשלה',
  softGateTitle: 'נשלים פרטים בסיסיים',
  fullNamePlaceholder: 'לדוגמה: רינה כהן',
  unknownError: 'שגיאה לא ידועה',
  saveAndContinue: 'לשמור ולהמשיך',
  // PR5a — UI sweep additions for (onboarding)/* screens.
  aboutIntroFinePrint:
    'רוצים לקרוא עוד על החזון, איך זה עובד ויצירת קשר? אחרי ההרשמה תמצאו את כל הפרטים תחת ״הגדרות״ ← ״אודות״.',
  continueA11y: 'המשך',
  photoReplaceA11y: 'החלפת תמונת פרופיל',
  photoAddA11y: 'הוספת תמונת פרופיל',
  photoReplaceCta: 'החלפת תמונה',
  photoChooseCta: 'בחירת תמונה',
  photoSubtitle: 'פנים מוכרות עוזרות לבנות אמון בקהילה.',
  photoContinueWithCta: 'המשך עם התמונה',
  photoContinueWithoutCta: 'המשך ללא תמונה',
  photoHint: 'אפשר להחליף תמונה מאוחר יותר בפרופיל.',
  tourGiveAndAskTitle: 'לתת ולבקש',
  tourGiveAndAskBody:
    'אפשר לפרסם פריטים למסירה או לבקש דברים שצריך, ותמיד אפשר גם לחפש — הכל בקהילה.',
  tourChatTitle: 'תאמו בצ׳אט',
  tourChatBody:
    'פותחים שיחה במהירות ישר דרך הפוסט, מתאמים איסוף בקלות, ומחזקים את הקהילה!',
  tourMarkDeliveredTitle: 'לסמן כנמסר',
  tourMarkDeliveredBody:
    'אחרי שהפריט עבר ידיים — מסמנים את הפוסט כסגור. ככה כולנו רואים את הקהילה זזה.',
  tourLetsStartCta: 'בואו נתחיל',
  tourNextCta: 'הבא',
} as const;
