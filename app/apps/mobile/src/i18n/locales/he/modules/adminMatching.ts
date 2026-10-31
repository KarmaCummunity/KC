// KC#1122 / FR-ADMIN-029 — admin match-quality dashboard.
export const adminMatchingHe = {
  title: 'איכות התאמות',
  subtitle: 'לפי עולם, לפי מועד ההתראה הראשונה על כל זוג',
  forbiddenTitle: 'אין לך הרשאה לצפות באיכות ההתאמות.',
  loading: 'טוען...',
  error: 'לא הצלחנו לטעון את הנתונים. משכו לרענון.',
  empty: 'אין התאמות שנשלחו בתקופה הזו.',
  windows: { d7: '7 ימים', d30: '30 ימים', d90: '90 ימים' },
  metrics: {
    notified: 'זוגות שקיבלו התראה',
    precision: 'דיוק (אישורים מתוך תשובות)',
    chat: 'פתחו צ׳אט',
    completion: 'הושלמה מסירה',
  },
  counts: (accepted: number, responses: number) => `${accepted}/${responses} תשובות`,
  pairs: (n: number) => `${n} זוגות`,
  notTracked: 'לא נמדד בעולם הזה',
};
