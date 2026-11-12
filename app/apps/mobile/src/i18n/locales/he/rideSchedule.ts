// Hebrew — ride quick publish: departure, estimated end and seats (spec 05 §5.3 step 1, D75, S46).
export const rideSchedule = {
  departure: 'שעת יציאה',
  leaveNow: 'יציאה עכשיו',
  leaveNowHint: 'הנסיעה יוצאת כמה דקות אחרי הפרסום.',
  arrival: 'סיום משוער',
  arrivalPlaceholder: 'יוצע לפי המסלול',
  arrivalHint: 'הצעה לפי המרחק — אפשר לשנות.',
  shortcut: {
    in30: 'בעוד חצי שעה',
    in60: 'בעוד שעה',
    tomorrow0700: 'מחר ב-07:00',
  },
  seats: 'מקומות פנויים',
  fewerSeats: 'פחות מקומות',
  moreSeats: 'יותר מקומות',
  publishAgain: 'פרסום הנסיעה שוב',
} as const;

// The shared date + time field (sheet actions).
export const dateTimeField = {
  done: 'אישור',
  cancel: 'ביטול',
} as const;

// The rides feed on the hub (D75): offers and requests by departure, grouped by day.
export const rideFeed = {
  group: { today: 'היום', tomorrow: 'מחר', later: 'בהמשך' },
  seatsLeft: 'מקומות פנויים: {{count}}',
  full: 'אין מקומות פנויים',
  passengers: 'נוסעים: {{count}}',
  meetingPoints: 'נקודות איסוף: {{count}}',
  empty: 'אין כרגע נסיעות קרובות. אפשר לפרסם נסיעה או בקשה.',
  error: 'לא הצלחנו לטעון את הנסיעות. משכו למטה כדי לנסות שוב.',
  // #1626 — empty-feed calls to action (neutral phrasing, spec 17 §7.2).
  publishCta: 'פרסום נסיעה',
  clearFilters: 'ניקוי הסינון',
  // #1626 — the route search is a collapsed filter on top of the rides feed.
  routeFilterTitle: 'סינון לפי מסלול',
  routeFilterActive: '{{from}} ← {{to}}',
  routeFilterClear: 'ניקוי מסלול',
} as const;

// Saved routes (D74): follow a route and hear about new rides on it.
export const rideRoutes = {
  follow: 'התראה על נסיעות במסלול הזה',
  wantsLabel: 'על מה להתריע?',
  wants: { offers: 'נסיעות מוצעות', requests: 'בקשות טרמפ' },
  daysLabel: 'באילו ימים? (בלי בחירה — כל יום)',
  weekday: { 0: 'א׳', 1: 'ב׳', 2: 'ג׳', 3: 'ד׳', 4: 'ה׳', 5: 'ו׳', 6: 'ש׳' },
  hoursLabel: 'באילו שעות?',
  anyHour: 'כל שעה',
  window: { morning: 'בוקר (06–10)', midday: 'צהריים (10–15)', evening: 'ערב (15–21)' },
  save: 'שמירת המסלול',
  saved: 'המסלול נשמר. נעדכן כשתתפרסם נסיעה מתאימה.',
  saveError: 'לא הצלחנו לשמור את המסלול. נסו שוב.',
  mine: 'המסלולים שלי',
  remove: 'הסרה',
  removeError: 'לא הצלחנו להסיר את המסלול. נסו שוב.',
} as const;

// Ride safety (D70): the emergency call during a ride and the no-profit cost cap.
export const rideSafety = {
  emergency: 'קריאת חירום',
  emergencyConfirm: 'לשלוח קריאת חירום לכל מי שבנסיעה ולצוות קארמה?',
  emergencySend: 'כן, לשלוח עכשיו',
  emergencyCancel: 'ביטול',
  emergencySent: 'קריאת החירום נשלחה. בסכנה מיידית חייגו 100.',
  costCapHint: 'השתתפות בהוצאות עד ₪{{cap}} — בלי רווח.',
} as const;

// Recurring rides (FR-RIDE-046): the switch in the create form, the labels on cards and
// the "my recurring rides" screen.
export const rideSeries = {
  toggle: 'טרמפ קבוע (חוזר)',
  daysLabel: 'באילו ימים?',
  endsOn: 'תאריך סיום',
  noEnd: 'בלי תאריך סיום',
  clearEnd: 'הסרת תאריך הסיום',
  publishHint: 'הנסיעה תתפרסם בכל יום שנבחר ב-{{time}}, חודש קדימה.',
  departureHint: 'שעת היציאה שתבחרו למעלה תהיה שעת הטרמפ הקבוע.',
  every: 'כל {{days}} ב-{{time}}',
  everyDay: 'כל יום ב-{{time}}',
  until: 'עד {{date}}',
  moreDates: 'עוד {{count}} מועדים',
  otherDates: 'מועדים נוספים',
  mine: 'הטרמפים הקבועים שלי',
  manage: 'ניהול הטרמפ הקבוע',
  empty: 'אין לכם עדיין טרמפ קבוע. בטופס הפרסום סמנו "טרמפ קבוע" ובחרו ימים.',
  error: 'לא הצלחנו לטעון את הטרמפים הקבועים. נסו שוב.',
  status: { paused: 'מושהה' },
  pause: 'השהיה',
  resume: 'חידוש',
  reschedule: 'שינוי זמנים',
  cancel: 'ביטול הטרמפ הקבוע',
  cancelConfirm: 'לבטל את הטרמפ הקבוע? כל הנסיעות העתידיות יבוטלו, גם כאלה שכבר הוזמנו, והנוסעים יקבלו הודעה.',
  cancelYes: 'כן, לבטל',
  keep: 'להשאיר',
  time: 'שעת יציאה',
  save: 'שמירה',
  saved: 'הזמנים עודכנו. נסיעות עתידיות בלי הזמנה פורסמו מחדש.',
  errors: {
    weekdaysRequired: 'בחרו לפחות יום אחד לטרמפ הקבוע.',
    generic: 'הפעולה נכשלה. נסו שוב.',
  },
} as const;
