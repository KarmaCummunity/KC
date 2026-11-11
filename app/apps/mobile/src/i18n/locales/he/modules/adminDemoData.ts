// FR-ADMIN-031 — admin demo-data screen (remove the kc-dev fake seed from the portal).
export const adminDemoDataHe = {
  title: 'נתוני דמה',
  subtitle: 'משתמשים ותוכן מזויפים של סביבת הפיתוח, כדי שאפשר יהיה לבדוק על נתונים אמיתיים בלבד.',
  forbiddenTitle: 'רק מנהל-על או מנהל הארגון של קארמה קהילה יכולים לנהל נתוני דמה.',
  loading: 'טוען...',
  error: 'לא הצלחנו לטעון את המצב. למשוך לרענון.',
  users: 'משתמשי דמה',
  organizations: 'עמותות דמה',
  ridePosts: 'טרמפים (פוסטים)',
  itemPosts: 'פוסטי פריטים',
  orgMemberships: 'תפקידים בעמותות דמה',
  chats: 'שיחות דמה',
  reports: 'דיווחים (מודרציה)',
  openReports: 'דיווחים פתוחים',
  postMedia: 'תמונות דמה (DB)',
  legacyRides: 'טרמפים ללא פרטי נסיעה (G1)',
  legacyRidesHint:
    'יש פוסטי טרמפ בלי שורה ב-ride_post_details. הריצו שחזור נתוני דמה אחרי deploy.',
  noneTitle: 'אין נתוני דמה במערכת',
  noneHintRestore: 'אפשר להחזיר אותם בלחיצה אחת.',
  noneHintNoRestore: 'שחזור זמין רק בסביבת הפיתוח.',
  seedButton: 'שחזור נתוני דמה',
  seedWhileDemoExistsHint: 'משחזר מחדש את כל נתוני הדמה (מוחק קודם את הקיימים, כמו בלחיצה על מחיקה ואז שחזור).',
  seeding: 'משחזר...',
  seedProgress: (step: string) =>
    step === 'running'
      ? 'משחזר נתוני דמה (כדקה–שתיים, אל תסגרו את המסך)…'
      : 'משחזר…',
  passwordLabel: 'סיסמה למשתמשי הדמה',
  passwordHint: 'נדרשת פעם אחת, לפחות 8 תווים. היא נשמרת מוצפנת.',
  seedDoneTitle: 'נתוני הדמה שוחזרו',
  seedDone: (users: number, posts: number, rides: number, orgs: number, orgMembers: number) =>
    `נוצרו ${users} משתמשים, ${posts} פוסטים (${rides} טרמפים), ${orgs} עמותות ו-${orgMembers} שיוכי צוות.`,
  seedFailed: 'השחזור נכשל. יש לנסות שוב.',
  wipeButton: 'מחיקת נתוני הדמה',
  wiping: 'מוחק...',
  wipeProgress: (step: string) =>
    step === 'running' ? 'מוחק נתוני דמה (כדקה–שתיים)…' : 'מוחק…',
  confirmTitle: 'למחוק את כל נתוני הדמה?',
  confirmBody: (users: number, orgs: number) =>
    `יימחקו ${users} משתמשי דמה עם כל התוכן שלהם (פוסטים, טרמפים, צ׳אטים, מעקבים) ו-${orgs} עמותות דמה. משתמשים אמיתיים לא ייפגעו. הפעולה אינה הפיכה מהפורטל.`,
  confirmOk: 'למחוק',
  confirmCancel: 'ביטול',
  doneTitle: 'נתוני הדמה נמחקו',
  done: (users: number, orgs: number) => `נמחקו ${users} משתמשים ו-${orgs} עמותות.`,
  orgsKept: (n: number) => `${n} עמותות דמה נשארו כי יש להן היסטוריית תשלומים.`,
  wipeFailed: 'המחיקה נכשלה. יש לנסות שוב.',
  errors: {
    generic: 'הפעולה נכשלה. נסו שוב או משכו לרענון.',
    forbidden: 'אין הרשאה. רק מנהל-על או מנהל ארגון קארמה קהילה יכולים לנהל דמה (לא מנהלי עמותה אחרים).',
    publisherRefs:
      'מחיקת הדמה נחסמה כי משתמש דמה מסומן כמפרסם מסמכים משפטיים. אחרי פריסת מיגרציה 0653 זה אמור להיפתר אוטומטית.',
    cannotWipeSelf: 'אי אפשר למחוק דמה כשאתם מחוברים כמשתמש דמה (@seed.kc.test). התנתקו ונסו מחשבון מנהל אמיתי.',
    notDevEnvironment: 'שחזור דמה זמין רק בבסיס הנתונים של סביבת הפיתוח (kc-dev).',
    passwordRequired: 'צריך סיסמה לפחות 8 תווים למשתמשי הדמה (פעם ראשונה).',
    passwordTooShort: 'הסיסמה קצרה מדי — לפחות 8 תווים.',
    timeout: 'שלב בפעולה ארך מדי. נסו שוב; אם זה חוזר, פנו לצוות.',
    operationBusy: 'פעולת דמה אחרת כבר רצה. המתינו לסיום או רעננו את המסך.',
  },
};
