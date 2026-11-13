// Hebrew — an organization's event (G1 step 5, D31): the create form's kind and organization
// choice, the event section of the post page, registration and the organizer's roster.
// Field and option labels (starts_at, registration_policy, automatic…) live in
// donations.marketplaceFields.ts; error copy in donations.marketplaceErrors.ts.
export const eventPost = {
  create: {
    kindLabel: 'מה אתם מציעים?',
    kindShift: 'משמרת התנדבות',
    kindEvent: 'אירוע של ארגון',
    // FR-POST-024 — a member's own event: a date, places and registration, and it may recur.
    kindPersonalEvent: 'התנדבות עם הרשמה',
    orgLabel: 'ארגון',
    orgRequired: 'בחרו את הארגון שהאירוע שלו',
    membershipHint: 'רוצים לפרסם אירוע של ארגון? חברי ארגון רשום מפרסמים אירועים. רשמו את הארגון שלכם, או בקשו ממנהל/ת הארגון לצרף אתכם.',
    membershipHintCta: 'הארגונים שלי',
  },
  section: {
    title: 'אירוע',
    startsAt: 'מתחיל: {{time}}',
    endsAt: 'מסתיים: {{time}}',
    address: 'כתובת: {{address}}',
    capacity: 'מקומות: {{count}}',
    policy: 'הרשמה: {{policy}}',
  },
  registration: {
    register: 'הרשמה',
    requestToJoin: 'בקשה להצטרף',
    cancel: 'ביטול ההרשמה',
    statusReserved: 'הבקשה שלכם מחכה לאישור המארגנים.',
    statusConfirmed: 'אתם רשומים.',
    statusWaitlisted: 'אתם ברשימת ההמתנה. כשיתפנה מקום תעלו אוטומטית.',
    leaveWaitlist: 'יציאה מרשימת ההמתנה',
    started: 'ההרשמה נסגרה: האירוע כבר התחיל.',
  },
  ownerClose: {
    cta: 'סיום האירוע',
    confirmTitle: 'לסיים את האירוע?',
    beforeStart: 'האירוע עוד לא התחיל. סיום עכשיו יבטל את כל ההרשמות, וכל הנרשמים יקבלו הודעה.',
    afterStart: 'ההרשמות נשארות, ואפשר לסמן מי הגיע גם אחרי סיום האירוע. רק נוכחות מסומנת מזכה בקארמה.',
    neutral: 'לפני תחילת האירוע, סיום יבטל את ההרשמות וכל הנרשמים יקבלו הודעה. אחרי שהתחיל, ההרשמות נשארות ואפשר לסמן מי הגיע.',
    confirm: 'סיום האירוע',
    done: 'האירוע הסתיים.',
  },
  roster: {
    title: 'נרשמים',
    summary: '{{confirmed}} מאושרים · {{waiting}} ממתינים לאישור · {{waitlisted}} ברשימת ההמתנה',
    empty: 'עדיין אין נרשמים.',
    loadError: 'לא הצלחנו לטעון את הנרשמים. הקישו כדי לנסות שוב.',
    nameFallback: 'חבר/ת קהילה',
    approve: 'אישור',
    decline: 'דחייה',
    remove: 'הסרה',
    attended: 'הגיע',
    noshow: 'לא הגיע',
    waitlistTitle: 'רשימת המתנה',
    waitlistPosition: 'מקום {{position}} ברשימת ההמתנה',
    statusLabel: {
      reserved: 'ממתין לאישור',
      confirmed: 'מאושר',
      waitlisted: 'ברשימת ההמתנה',
      cancelled: 'בוטל',
      handed_over: 'השתתף',
      no_show: 'לא הגיע',
    },
  },
} as const;
