// Hebrew — direct support for KC: one-time + monthly standing order (FR-DONATE-011, D20).
// The disclosure lines are the donor-facing legal notice; change them only with PM approval.
export const supportKc = {
  title: 'תמיכה ישירה בקהילת קארמה',
  tagline: 'קארמה היא פלטפורמה חינמית לכולם. התרומה שלך מממנת את הפיתוח וההפעלה שלה.',
  oneTimeHeading: 'תרומה חד־פעמית',
  standingOrderHeading: 'הוראת קבע חודשית',
  standingOrderBody: 'תרומה חודשית קבועה בכרטיס אשראי, בסכום שתבחרו, בעמוד התשלום המאובטח של {{provider}}.',
  channel: {
    bit: 'העברה בביט',
    paybox: 'העברה בפייבוקס',
    card_one_time: 'כרטיס אשראי',
    card_standing_order: 'הגדרת הוראת קבע',
  },
  channelA11y: '{{label}} — נפתח מחוץ לאפליקציה, בעמוד התשלום של {{provider}}',
  loading: 'טוען אפשרויות תרומה…',
  unavailable: 'אפשרויות התרומה הישירה אינן זמינות כרגע. נסו שוב מאוחר יותר.',
  linkError: 'לא הצלחנו לפתוח את עמוד התשלום. נסו שוב או פתחו אותו בדפדפן.',
  disclosureTitle: 'לפני שתורמים',
  disclosureSecure:
    'התשלום מתבצע מחוץ לאפליקציה, אצל ספק תשלומים מורשה. פרטי האשראי והחשבון שלך לא עוברים דרכנו ולא נשמרים אצלנו.',
  disclosureRecipient: 'הכסף מועבר לקהילת קארמה ומשמש לפיתוח ולהפעלה של הפלטפורמה בלבד.',
  disclosureTax:
    'קהילת קארמה אינה עמותה רשומה עדיין, ולכן התרומה אינה מזכה בזיכוי מס לפי סעיף 46. אישור תשלום יישלח אליך מספק התשלום.',
  disclosureVoluntary: 'התרומה וולונטרית ואינה מקנה הטבה, שירות או עדיפות באפליקציה.',
  disclosureCancel: 'אפשר לבטל את הוראת הקבע בכל עת. הביטול ייכנס לתוקף תוך 3 ימי עסקים לכל המאוחר.',
  cancelCta: 'בקשה לביטול הוראת קבע',
  cancelConfirmTitle: 'ביטול הוראת קבע',
  cancelConfirmBody: 'נשלח לצוות קארמה בקשת ביטול בצ׳אט התמיכה, ושם נאשר לך שהביטול בוצע.',
  cancelConfirm: 'שליחת בקשה',
  cancelMessage: 'בקשה לביטול הוראת הקבע שלי לתמיכה בקהילת קארמה.',
  cancelError: 'לא הצלחנו לשלוח את הבקשה. נסו שוב.',
  partnersTitle: 'תרומה לעמותות',
  partnersBody: 'רוצים לתרום לעמותה? ב־jgive תמצאו מגוון רחב של עמותות רשומות לתרומה מאובטחת.',
} as const;
