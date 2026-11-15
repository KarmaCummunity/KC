// Hebrew — Statistics dashboard (FR-STATS-001..004).
// Locale file under `locales/he/`; composed into the bundle via `locales/he/index.ts`.

export const stats = {
  title: 'הקהילה במספרים',
  subtitle: 'מונים אישיים, פעילות אחרונה, ומצב הקהילה',
  given: 'חפצים שמסרתי',
  received: 'חפצים שקיבלתי',
  activePosts: 'פוסטים פעילים',
  communityTitle: 'בקהילה עכשיו',
  communityUsers: 'משתמשים רשומים',
  communityPosts: 'פוסטים פתוחים (ציבורי)',
  communityDelivered: 'מסירות שהושלמו',
  communityHint: 'המספרים מתעדכנים אוטומטית כל דקה.',
  recentActivity: 'מה קורה אצלי',
  // FR-STATS-008 — the member's own givings per world.
  byWorldTitle: 'הנתינות שלי לפי עולם',
  byWorldGiven: 'נתתי',
  byWorldReceived: 'קיבלתי',
  byWorldClosed: 'נסגרו',
  byWorldEmpty: 'כשנתינה תימסר, היא תופיע כאן לפי העולם שלה.',
  activityEmpty: 'עדיין אין פעילות להצגה. פרסום או סגירה של פוסט יופיעו כאן.',
  activitySomeone: 'משתמש/ת',
  activityKind: {
    post_created: 'יצרת את הפוסט ״{{title}}״',
    post_closed_delivered: 'סימנת מסירה של ״{{title}}״',
    post_closed_no_recipient: 'סגרת את ״{{title}}״ בלי לסמן מקבל/ת',
    post_reopened: 'פתחת מחדש את ״{{title}}״',
    marked_as_recipient: '{{owner}} סימנו אותך כמקבל/ת של ״{{title}}״',
    unmarked_as_recipient: 'הסרת את סימון המקבל/ת מ״{{title}}״',
    post_expired: 'הפוסט ״{{title}}״ פג תוקף',
    post_removed_admin: 'הפוסט ״{{title}}״ הוסר על ידי הצוות',
  },
  // #2078 — volunteering takes place; it is not delivered to a recipient.
  activityKindTime: {
    post_closed_delivered: 'סימנת שההתנדבות ״{{title}}״ התקיימה',
    marked_as_recipient: '{{owner}} סימנו אותך בהתנדבות ״{{title}}״',
    unmarked_as_recipient: 'הסרת את הסימון שלך מההתנדבות ״{{title}}״',
  },
};
