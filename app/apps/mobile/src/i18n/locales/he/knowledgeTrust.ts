// Hebrew — knowledge trust copy (FR-KNOW-012, D40, D184, #2038): consulting-hour
// complete-profile gate, the "not binding advice" notice, and official shelf links.
export const knowledgeTrust = {
  create: {
    verifyTitle: 'פרופיל מלא לפני שעת ייעוץ',
    verifyBody:
      'שעת ייעוץ מקצועית דורשת פרופיל מלא (שם, עיר, תמונה, טלפון ועוד). אין צורך באימות זהות.',
    verifyCta: 'להשלמת הפרופיל',
  },
  notice: {
    title: 'לא ייעוץ מחייב',
    body:
      'זה מידע כללי ודעה של מתנדב/ת, לא ייעוץ משפטי, פיננסי או רפואי מחייב. לתשובה מחייבת פנו לגוף מוסמך.',
  },
  consulting: {
    profession: 'תחום מקצועי: {{profession}}',
    verification: 'רמת אימות של המציע/ה',
  },
  shelfLinks: {
    title: 'גופים רשמיים',
    openA11y: 'פתיחת האתר של {{name}}',
    linkError: 'לא הצלחנו לפתוח את הקישור. נסו שוב מאוחר יותר.',
  },
} as const;
