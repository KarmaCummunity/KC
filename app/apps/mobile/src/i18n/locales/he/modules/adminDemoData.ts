// FR-ADMIN-031 — admin demo-data screen (remove the kc-dev fake seed from the portal).
export const adminDemoDataHe = {
  title: 'נתוני דמה',
  subtitle: 'משתמשים ותוכן מזויפים של סביבת הפיתוח, כדי שאפשר יהיה לבדוק על נתונים אמיתיים בלבד.',
  forbiddenTitle: 'רק מנהל-על יכול לנהל נתוני דמה.',
  loading: 'טוען...',
  error: 'לא הצלחנו לטעון את המצב. למשוך לרענון.',
  users: 'משתמשי דמה',
  organizations: 'עמותות דמה',
  noneTitle: 'אין נתוני דמה במערכת',
  noneHint: 'כדי להחזיר אותם, יש להריץ את הפעולה ״Seed KC dev״ ב-GitHub Actions.',
  restoreNote: 'להחזרת נתוני הדמה: GitHub Actions ← Seed KC dev ← seed.',
  wipeButton: 'מחיקת נתוני הדמה',
  wiping: 'מוחק...',
  confirmTitle: 'למחוק את כל נתוני הדמה?',
  confirmBody: (users: number, orgs: number) =>
    `יימחקו ${users} משתמשי דמה עם כל התוכן שלהם (פוסטים, טרמפים, צ׳אטים, מעקבים) ו-${orgs} עמותות דמה. משתמשים אמיתיים לא ייפגעו. הפעולה אינה הפיכה מהפורטל.`,
  confirmOk: 'למחוק',
  confirmCancel: 'ביטול',
  doneTitle: 'נתוני הדמה נמחקו',
  done: (users: number, orgs: number) => `נמחקו ${users} משתמשים ו-${orgs} עמותות.`,
  orgsKept: (n: number) => `${n} עמותות דמה נשארו כי יש להן היסטוריית תשלומים.`,
  wipeFailed: 'המחיקה נכשלה. יש לנסות שוב.',
};
