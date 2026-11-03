// D9 — Hebrew strings for the /admin/donation-links review screen.
export const adminDonationLinksHe = {
  title: 'אישור קישורי תרומה',
  hint: 'קישור שהוצע יופיע לכולם רק אחרי אישור. עריכה של קישור מאושר מחזירה אותו לכאן.',
  forbidden: 'אין לך הרשאה למסך זה.',
  loading: 'טוען...',
  empty: 'אין קישורים במצב הזה.',
  loadError: 'לא הצלחנו לטעון את הרשימה. כדאי לנסות שוב.',
  filters: { pending: 'ממתינים', approved: 'מאושרים', rejected: 'לא אושרו' },
  submittedBy: 'הוצע על ידי',
  unknownSubmitter: 'משתמש',
  notePlaceholder: 'סיבת הדחייה (לא חובה)',
  approve: 'לאשר',
  reject: 'לדחות',
  actionFailed: 'הפעולה לא בוצעה. ייתכן שהקישור כבר טופל.',
} as const;
