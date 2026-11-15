// Hebrew copy of the staff support inbox (FR-CHAT-007, FR-MOD-002) and the review queue
// (FR-MOD-008), restored at the baseline. Merged into `admin` by the locale index.
export const adminStaffToolsHe = {
  nav: {
    support:     'תיבת תמיכה',
    reviewQueue: 'תור בדיקה',
  },
  supportInbox: {
    title:          'תיבת התמיכה',
    subtitle:       'פניות של חברי הקהילה, מהעדכנית ביותר. פותחים שיחה כדי לענות.',
    loading:        'טוען פניות…',
    forbiddenTitle: 'אין לך הרשאה לתיבת התמיכה',
    emptyTitle:     'אין פניות',
    emptyHint:      'כשחבר או חברה בקהילה יפנו לתמיכה, השיחה תופיע כאן.',
    unnamedMember:  'חשבון שנמחק',
    joined:         'בטיפולך',
    lastMessage:    (when: string) => `הודעה אחרונה: ${when}`,
    openCta:        'פתיחת השיחה',
    openFailed:     'לא הצלחנו לפתוח את השיחה. כדאי לנסות שוב.',
  },
  reviewQueue: {
    title:          'תור הבדיקה',
    subtitle:       'פריטים שממתינים לבדיקת הצוות, מהישן לחדש.',
    loading:        'טוען את התור…',
    forbiddenTitle: 'אין לך הרשאה לתור הבדיקה',
    emptyTitle:     'התור ריק',
    emptyHint:      'כל הפריטים טופלו.',
    reasons: {
      report_threshold:  'הגיע לסף הדיווחים',
      excessive_reopens: 'נפתח מחדש פעמים רבות',
      forbidden_keyword: 'מילה אסורה',
      manual_flag:       'סומן ידנית',
      operator_case:     'מקרה לטיפול',
    },
    targets: {
      post:    'פוסט',
      user:    'משתמש',
      comment: 'תגובה',
      chat:    'שיחה',
    },
    openedAt:    (when: string) => `נפתח: ${when}`,
    assignedToMe: 'בטיפולך',
    assigned:     'בטיפול',
    takeCta:      'לקחת לטיפול',
    resolveCta:   'סימון כטופל',
    openCta:      'פתיחה',
    actionFailed: 'הפעולה לא בוצעה. ייתכן שהפריט כבר טופל.',
  },
};
