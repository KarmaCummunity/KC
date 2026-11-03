// FR-AUTH-016 — restore a deleted account within its 30-day grace period.
export const restoreAccountHe = {
  title: 'החשבון שלך מושבת',
  body: 'מחקת את החשבון. אפשר לשחזר אותו במלואו עד {{date}}. אחרי התאריך הזה הכל נמחק לצמיתות.',
  restore: 'שחזר את החשבון',
  restoring: 'משחזר…',
  signOut: 'התנתק',
  errors: {
    generic: 'השחזור נכשל. בדוק את החיבור ונסה שוב.',
    expired: 'תקופת השחזור הסתיימה והחשבון נמחק.',
    notPending: 'החשבון כבר פעיל.',
  },
} as const;
