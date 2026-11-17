// §5.11 (#1476) — Hebrew strings for the /admin/org-jobs screen: which organizations may publish
// job offers, switched by platform admins.
export const adminOrgJobsHe = {
  title: 'ארגונים שמפרסמים משרות',
  hint: 'הצעת עבודה מתפרסמת רק בשם ארגון שאושר כאן, אחרי בדיקה שהוא רשאי להעסיק. Karma Community תמיד רשאית. הפסקת האישור לא סוגרת משרות שכבר פורסמו.',
  readOnly: 'רק מנהלי פלטפורמה יכולים לשנות את האישור.',
  loading: 'טוען...',
  loadError: 'לא הצלחנו לטעון את הארגונים.',
  empty: 'אין עדיין ארגונים.',
  allowed: 'רשאי לפרסם משרות',
  notAllowed: 'לא רשאי לפרסם משרות',
  platform: 'הארגון של KC: תמיד רשאי',
  suspended: 'מושעה: לא מפרסם',
  allow: 'אישור',
  stop: 'הפסקה',
  saveError: 'לא הצלחנו לעדכן את הארגון. כדאי לנסות שוב.',
} as const;
