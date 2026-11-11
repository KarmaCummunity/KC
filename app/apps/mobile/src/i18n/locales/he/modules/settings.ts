// FR-SETTINGS strings split from main bundle (TD-35 file-size budget).
export const settingsHe = {
  title: 'הגדרות',
  account: 'חשבון',
  accountDetails: 'פרטי חשבון',
  notifications: 'התראות',
  notificationsOn: 'התראות מופעלות',
  privacy: 'פרטיות',
  statsSection: 'סטטיסטיקות',
  stats: 'סטטיסטיקות',
  support: 'תמיכה',
  legal: 'משפטי',
  termsOfService: 'תנאי שימוש',
  privacyPolicy: 'מדיניות פרטיות',
  about: 'אודות',
  aboutCard: {
    title: 'אודות קהילת קארמה',
    subtitle: 'החזון, איך זה עובד, צוות, שאלות נפוצות ויצירת קשר',
    cta: 'למידע נוסף',
    a11y: 'אודות קהילת קארמה — פתיחת עמוד אודות',
  },
  logout: 'התנתקות',
  loggingOut: 'מתנתק...',
  deleteAccount: 'מחיקת חשבון',
  deleteAccountModal: {
    title: 'מחיקת חשבון',
    bullets: {
      posts: 'הפרופיל, הפוסטים והמודעות שלך יוסתרו מכולם מיד',
      follows: 'העוקבים והנעקבים שלך נשמרים במשך 30 יום',
      moderation: 'החסימות והדיווחים שהגשת נשמרים במשך 30 יום',
      donations: 'קישורי תרומה שהגדרת יימחקו בתום 30 הימים',
      devices: 'כל המכשירים המחוברים שלך ינותקו',
    },
    chatsRetention:
      'שיחות שניהלת יישארו אצל האנשים שדיברת איתם. הם יראו את ההודעות שכתבת, אבל לא את שמך, התמונה או הפרופיל — רק "{{deletedUserLabel}}".',
    warning:
      'החשבון יושבת ל-30 יום. אם תיכנס אליו שוב בתקופה הזו תוכל לשחזר אותו במלואו. אחרי 30 יום הכל נמחק לצמיתות.',
    confirmInputLabel: 'להקליד "מחק" כדי לאשר',
    confirmInputPlaceholder: 'מחק', // copy-voice-allow: confirm keyword the user types
    confirmKeyword: 'מחק', // copy-voice-allow: confirm keyword the user types
    buttons: {
      cancel: 'ביטול',
      delete: 'מחיקת החשבון',
      retry: 'לנסות שוב',
      close: 'סגור',
    },
    errors: {
      recoverable: 'המחיקה נכשלה — אפשר לנסות שוב',
      critical:
        'המחיקה לא הושלמה. הפוסטים והעוקבים שלך כבר נמחקו, אבל סגירת החשבון לא הסתיימה. חובה ללחוץ "נסה שוב" עכשיו — אם תסגור את האפליקציה ייווצר חשבון לא תקין.',
    },
    blocked: {
      title: 'לא ניתן למחוק חשבון מושעה',
      body: 'פנה לבירור דרך מסך הדיווחים.',
    },
    success: {
      title: 'חשבונך נמחק',
      subtitle: 'תודה שהיית חלק מקארמה.',
    },
  },
  privateProfileToggle: 'פרופיל פרטי',
  activeStatusToggle: 'הצגת הסטטוס הפעיל שלי',
  activeStatusHint: 'כשהאפשרות כבויה, אחרים לא יראו מתי אתם מחוברים, וגם אתם לא תראו מתי אחרים מחוברים.',
  followRequests: 'בקשות עקיבה',
  appearance: 'מראה',
  appearanceScreen: {
    title: 'מראה',
    intro: 'בחרו כיצד תרצו שהאפליקציה תיראה. ניתן לעקוב אחרי הגדרות המכשיר או לבחור מצב קבוע.',
    sectionMode: 'מצב תצוגה',
    modeSystemLabel: 'אוטומטי',
    modeSystemHint: 'מתעדכן עם המכשיר (יום/לילה).',
    modeLightLabel: 'בהיר',
    modeLightHint: 'מצב יום קבוע — חם וקרמי.',
    modeDarkLabel: 'כהה',
    modeDarkHint: 'מצב לילה קבוע — חם וכהה, ידידותי לעיניים.',
    previewLabel: 'תצוגה מקדימה',
    previewHeading: 'קהילת קארמה',
    previewBody: 'נראה איך הצבעים יראו על מסך אמיתי.',
    previewPrimary: 'נתינה',
    previewSecondary: 'בקשה',
  },
  reportIssue: 'דיווח על בעיה',
  reportIssueScreen: {
    title: 'דיווח על בעיה',
    copy: 'תאר את הבעיה ואנחנו נחזור אליך בהקדם.',
    categoryLabel: 'קטגוריה (אופציונלי)',
    categories: {
      Bug: 'באג / תקלה',
      Account: 'פרופיל והתחברות',
      Suggestion: 'הצעה',
      Other: 'אחר',
    } as Record<string, string>,
    descriptionLabel: 'תיאור (חובה)',
    descriptionPlaceholder: 'תאר את הבעיה... (לפחות 10 תווים)',
    descriptionMinLength: 'התיאור חייב להכיל לפחות 10 תווים',
    submitBtn: 'שליחה ופתיחת שיחה',
    submitting: 'שולח...',
    errorGeneric: 'אירעה שגיאה. אפשר לנסות שוב.',
    errorAdminNotFound: 'שירות התמיכה לא זמין. אפשר לנסות שוב מאוחר יותר.',
    errorTooLong: 'התיאור ארוך מ-500 תווים. אפשר לקצר ולשלוח שוב.',
  },
  devTools: 'כלי פיתוח',
  resetOnboarding: 'איפוס אונבורדינג (דיבוג)',
  resetting: 'מאפס...',
  simulateHardRefresh: 'סימולציית רענון מלא (דיבוג)',
  simulatingHardRefresh: 'מרענן...',
  version: 'KC - קהילת קארמה',
  resetOnboardingFailed: 'האיפוס נכשל: {{msg}}',
  resetOnboardingConfirmMsg: 'הפעולה תחזיר את מצב האונבורדינג להתחלה ותפתח את אשף ההרשמה מחדש. הפרופיל לא יימחק.\n\nלהמשיך?',
  resetOnboardingConfirmTitle: 'איפוס אונבורדינג',
  resetOnboardingBtn: 'איפוס',
  signOutFailed: 'ההתנתקות נכשלה. אפשר לנסות שוב.',

  // PR5d (UI sweep, Pattern #1) — Stack header title for /edit-profile.
  editProfileTitle: 'עריכת פרופיל',

  // Follow-requests inbox (FR-FOLLOW-007)
  followRequestsScreen: {
    headerTitle: 'בקשות עוקבים',
    empty: 'אין בקשות ממתינות.\nבקשות חדשות יופיעו כאן.',
    approve: 'אשר',
    reject: 'דחה',
    errorTitle: 'שגיאה',
    errorMessage: 'הפעולה נכשלה. נסו שוב.',
  },

  // Privacy screen (FR-PROFILE-005 / FR-PROFILE-006)
  privacyScreen: {
    privateProfileLabel: 'פרופיל פרטי',
    privateProfileHint: 'רק עוקבים מאושרים יראו את הפוסטים והעוקבים שלך.',
    followRequestsLink: 'בקשות עוקבים',
    followRequestsLinkWithCount: 'בקשות עוקבים ({{count}})',
    confirmPrivateTitle: 'להפוך את הפרופיל לפרטי?',
    confirmPublicTitle: 'להפוך את הפרופיל לציבורי?',
    confirmPrivateMessage:
      'בקשות עקיבה חדשות ידרשו אישור. עוקבים קיימים יישארו (אפשר להסיר אותם ידנית). פוסטים פתוחים יישארו פתוחים. אפשר לפרסם פוסטים חדשים לעוקבים בלבד.',
    confirmPublicMessage:
      'כל הבקשות הממתינות יאושרו אוטומטית. פוסטים שפורסמו לעוקבים בלבד יישארו גלויים לכל עוקב חדש מעכשיו.',
    confirmPrivateCta: 'להפוך לפרטי',
    confirmPublicCta: 'להפוך לציבורי',
  },

  // Report-issue notify-modal title (FR-MOD-002 / FR-CHAT-007 AC3)
  reportIssueErrorTitle: 'שגיאה',


  // FR-TRANSLATE-003 — translation language preference
  translationLanguage: 'שפת תרגום',
  translationLanguageDeviceDefault: 'ברירת מחדל של המכשיר',
  translationLanguageIntro:
    'פוסטים שנכתבו בשפה אחרת יתורגמו אוטומטית לשפה שתבחרו. תמיד אפשר להציג את המקור.',
  translationLanguageSaveFailed: 'שמירת שפת התרגום נכשלה. נסו שוב.',
  translationLanguageNames: {
    he: 'עברית',
    en: 'אנגלית',
    ar: 'ערבית',
    ru: 'רוסית',
  },

  // FR-SETTINGS-018 — app interface language (Hebrew ↔ English)
  language: 'שפת האפליקציה',
  languageScreen: {
    title: 'שפת האפליקציה',
    intro: 'בחרו את שפת הממשק של האפליקציה.',
    optionHe: 'עברית',
    optionEn: 'English',
    restartNote: 'שינוי השפה יטען מחדש את האפליקציה.',
    saveFailed: 'החלפת השפה נכשלה. נסו שוב.',
    switchA11y: 'החלפת שפה / Change language',
  },
  whatsappRow: 'חיבור לוואטסאפ',
  whatsapp: {
    title: 'בוט הוואטסאפ',
    intro: 'קשרו את מספר הוואטסאפ שלכם לחשבון כדי לפרסם ולחפש דרך הבוט. השירות זמין למנויי Pro.',
    notPro: 'בוט הוואטסאפ זמין רק למנויי Pro.',
    linked: 'מחובר למספר {{number}}',
    notLinked: 'עדיין לא מחובר',
    getCode: 'קבלו קוד חיבור',
    codeLabel: 'שלחו לבוט בוואטסאפ את הקוד:',
    codeExpires: 'הקוד בתוקף עד {{time}}',
    unlink: 'ניתוק המספר',
    unlinkConfirm: 'לנתק את מספר הוואטסאפ מהחשבון?',
    failed: 'הפעולה נכשלה. נסו שוב.',
  },
} as const;
