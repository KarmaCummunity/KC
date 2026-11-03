// FR-STATS-007 — Hebrew strings for the /admin/stats platform statistics screen.
export const adminStatsHe = {
  title: 'סטטיסטיקות הפלטפורמה',
  subtitle: 'המסלול של כל עולם: מה שפורסם בתקופה, כמה הוזמן, אושר, נמסר או בוטל, וכמה זמן זה לקח.',
  loading: 'טוען...',
  forbidden: 'אין לך הרשאה למסך זה.',
  error: 'לא הצלחנו לטעון את הנתונים. כדאי לנסות שוב.',
  empty: 'אין פוסטים שפורסמו בתקופה הזו.',
  windows: { d7: '7 ימים', d30: '30 יום', d90: '90 יום' },
  directions: { give: 'הצעות', request: 'בקשות' },
  totals: 'נתינות שנסגרו בתקופה',
  metrics: {
    published: 'פורסמו',
    booked: 'הוזמנו',
    confirmed: 'אושרו',
    completed: 'נמסרו',
    cancelled: 'בוטלו',
    closed: 'נסגרו',
    hoursToBooking: 'שעות עד הזמנה (חציון)',
    hoursToCompletion: 'שעות עד מסירה (חציון)',
  },
  notTracked: 'לא נמדד בעולם הזה',
} as const;
