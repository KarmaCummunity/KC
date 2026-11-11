// FR-CLOSURE-001..005 strings (closure sheet, recipient picker, explainer,
// reopen confirm, owner actions bar). Extracted to its own module to keep
// `index.ts` under the 200-LOC cap (TD-156 slice 6).
export const closureHe = {
  // FR-CLOSURE-001 — owner CTAs on PostDetail (OwnerActionsBar)
  detailCloseSuccessToast: 'הפוסט נסגר בהצלחה.',
  detailReopenSuccessToast: 'הפוסט נפתח מחדש בהצלחה.',
  markGiveCta: 'לסמן כנמסר ✓',
  markAnimalsCta: 'סומן כמסור',
  markHousingCta: 'סיום האירוח',
  markRidesCta: 'שיבוץ נוסע',
  // #2078, D141 — volunteering is not "delivered"; it takes place.
  markTimeCta: 'ההתנדבות התקיימה ✓',
  assignUserCta: 'שבץ למשתמש',
  assignSuccessToast: 'המשתמש שובץ.',
  markRequestCta: 'לסמן שקיבלתי ✓',
  /** Shared CTA copy — owner reopen + recipient un-mark (FR-CLOSURE-005 / FR-CLOSURE-007). */
  itemNotDeliveredCta: 'החפץ לא נמסר בסוף',
  itemNotDeliveredA11y: 'החפץ לא נמסר בסוף',
  reopenCta: '📤 לפתוח מחדש',
  reopenA11y: 'לפתוח מחדש',

  // FR-CLOSURE-002 — Step 1 confirmation (ClosureSheet > Step1)
  step1GiveTitle: '🤝  האם הפריט באמת נמסר?',
  step1RequestTitle: '🤝  האם באמת קיבלת את הפריט?',
  step1GiveBody:
    'חשוב לסמן רק אחרי המסירה הפיזית — לא אחרי תיאום בצ\'אט. אם הפריט עדיין לא הגיע ליד מקבל, אל תסמן.',
  step1RequestBody:
    'חשוב לסמן רק אחרי שהפריט הגיע אליך — לא אחרי תיאום בצ\'אט. אם עדיין לא קיבלת את הפריט, אל תסמן.',
  step1GiveCta: 'כן, נמסר ✓',
  step1RequestCta: 'כן, קיבלתי ✓',

  // FR-CLOSURE-003 — Step 2 recipient picker (ClosureStep2)
  step1FoodTitle: '🤝  האוכל באמת נמסר?',
  step1FoodBody: 'סמנו רק אחרי שהאוכל הגיע, לא אחרי תיאום בצ\'אט.',
  step1FoodCta: 'כן, נמסר ✓',
  step1AnimalsTitle: '🤝  בעל החיים באמת נמסר?',
  step1AnimalsBody: 'סמנו רק אחרי המסירה בפועל, לא אחרי תיאום בצ\'אט.',
  step1AnimalsCta: 'כן, נמסר ✓',
  step1RidesTitle: '🤝  לשבץ את הנוסע?',
  step1RidesBody: 'שבצו נוסע כדי לשריין לו מקום, או אחרי שהוא כבר נסע איתכם.',
  step1RidesCta: 'כן, לשבץ',
  step1HousingTitle: '🤝  לאשר את האירוח?',
  step1HousingBody: 'שבצו אורח כדי לשריין לו מקום, או אחרי שהלינה התקיימה.',
  step1HousingCta: 'כן, לאשר',
  step1KnowledgeTitle: '🤝  המפגש התקיים?',
  step1KnowledgeBody: 'סמנו רק אחרי שהמפגש קרה, לא אחרי תיאום בצ\'אט.',
  step1KnowledgeCta: 'כן, התקיים ✓',
  step1TimeTitle: '🤝  ההתנדבות התקיימה?',
  step1TimeBody: 'סמנו רק אחרי שההתנדבות קרתה, לא אחרי תיאום בצ\'אט.',
  step1TimeCta: 'כן, התקיימה ✓',
  step2GiveTitle: '🎁  למי מסרת את הפריט?',
  step2RequestTitle: '🎁  ממי קיבלת את הפריט?',
  step2FoodTitle: '🎁  למי נמסר האוכל?',
  step2AnimalsTitle: '🎁  למי נמסר בעל החיים?',
  step2RidesTitle: '🎁  את מי לשבץ לטרמפ?',
  step2HousingTitle: '🎁  את מי לארח?',
  step2KnowledgeTitle: '🎁  עם מי היה המפגש?',
  step2TimeTitle: '🎁  עם מי הייתה ההתנדבות?',
  step2CloseWithoutMarking: 'סגור בלי לסמן',
  step2MarkAndClose: 'לסמן ולסגור ✓',
  step2RidesPrimary: 'שבץ נוסע',
  step2HousingPrimary: 'שבץ אורח',
  step2KnowledgePrimary: 'לסמן שהתקיים ✓',
  step2TimePrimary: 'לסמן שהתקיימה ✓',
  step2NoSearchResults: 'לא נמצא משתמש בשם כזה.',

  // ClosureRecipientPanes (sub-component of Step 2)
  pickModeChats: 'מצ\'אטים שלי',
  pickModeSearch: 'חיפוש כללי',
  searchPlaceholder: 'לחפש לפי שם או handle',
  chatsEmpty:
    'עדיין לא היה איתך צ\'אט עם אף אחד. עבור ל"חיפוש כללי" כדי לבחור מהרשימה הכללית, או לחץ "סגור בלי לסמן".',
  chatsEmptyNamedOnly:
    'עדיין לא היה איתך צ\'אט עם אף אחד. עבור ל"חיפוש כללי" כדי לבחור מהרשימה.',

  // FR-CLOSURE-004 — educational explainer (ClosureExplainerSheet)
  explainerFoodTitle: '✨  תודה שמסרת!',
  explainerFoodBody: 'האוכל סומן כנמסר לאדם שבחרת.',
  explainerAnimalsTitle: '✨  תודה על המסירה!',
  explainerAnimalsBody: 'בעל החיים סומן כנמסר לאדם שבחרת.',
  explainerRidesTitle: '✨  הנוסע שובץ',
  explainerRidesBody: 'המושב שמור לו. הטרמפ נשאר פתוח לאחרים עד שאין עוד מקומות או עד סיום הנסיעה.',
  explainerHousingTitle: '✨  האורח שובץ',
  explainerHousingBody: 'האירוח שמור לו. המודעה נשארת פתוחה לאורחים נוספים.',
  explainerKnowledgeTitle: '✨  המפגש סומן',
  explainerKnowledgeBody: 'המפגש נרשם עם האדם שבחרת.',
  explainerTimeTitle: '✨  תודה על ההתנדבות!',
  explainerTimeBody: 'ההתנדבות נרשמה עם האדם שבחרת.',
  explainerGiveTitle: '✨  תודה שתרמת!',
  explainerRequestTitle: '✨  תודה שעדכנת!',
  explainerLead: 'כך זה עובד:',
  explainerGiveMarkedBullet:
    '• פוסטים שסומנו עם מקבל — נשמרים לתמיד ומופיעים בסטטיסטיקה שלך ושל המקבל.',
  explainerRequestMarkedBullet:
    '• פוסטים שסומנו עם נותן — נשמרים לתמיד ומופיעים בסטטיסטיקה שלך ושל הנותן.',
  explainerMiddleBullet:
    '• פוסטים שנסגרו בלי לסמן — נשמרים 7 ימים למקרה של טעות, ואז נמחקים אוטומטית.',
  explainerGiveCounterBullet: '• בכל מקרה — "פריטים שתרמתי" שלך עולה ב-1.',
  explainerRequestCounterBullet: '• בכל מקרה — "פריטים שקיבלתי" שלך עולה ב-1.',
  explainerDontShowAgain: 'אל תציג שוב',

  // FR-CLOSURE-001 — error pane (ClosureErrorPane)
  errorTitle: '⚠️  משהו לא עבד',
  errorDefault: 'לא הצלחנו להתחיל את תהליך הסגירה. אפשר לנסות שוב עוד רגע.',

  // FR-CLOSURE-005 — reopen confirm (ReopenConfirmModal)
  itemNotDeliveredModalTitle: 'החפץ לא נמסר בסוף?',
  reopenTitle: '📤  לפתוח את הפוסט מחדש?',
  reopenBodyClosedDelivered: 'הפוסט יחזור להיות פעיל בפיד.',
  reopenBodyDeletedNoRecipient: 'הפוסט יחזור להיות פעיל בפיד והוא לא יימחק.',
  reopenBulletMarkedRemoved: '• הסימון של {{markedSide}} יוסר.',
  reopenBulletMarkedCounter: '• "{{counter}}" שלו יקטן ב-1 (בלי התראה).',
  reopenBulletOwnerCounter: '• "{{counter}}" שלך יקטן ב-1.',
  reopenConfirmCta: 'לפתוח מחדש',
  markedSideGive: 'מי שקיבל',
  markedSideRequest: 'מי שמסר לך',
  counterDonated: 'פריטים שתרמתי',
  counterReceived: 'פריטים שקיבלתי',

  // RecipientCallout (closed_delivered post-detail row)
  calloutGiveLabel: 'נמסר ל',
  calloutRequestLabel: 'ניתן על-ידי',
  calloutGiveSublabel: 'הפריט נמסר',
  calloutRequestSublabel: 'הבקשה נענתה',

  // RecipientUnmarkBar (FR-CLOSURE-007)
  unmarkSelfCta: 'החפץ לא נמסר בסוף',
  unmarkSelfA11y: 'החפץ לא נמסר בסוף',
  unmarkConfirmTitle: 'החפץ לא נמסר בסוף?',
  unmarkConfirmBody:
    'לא תקבל קרדיט על פריט זה, ובעל הפוסט יקבל הודעה. הפוסט יישמר 7 ימים לפני מחיקה.',
  unmarkConfirmCta: 'להסיר',
  unmarkErrorBody: 'לא הצלחנו להסיר את הסימון. אפשר לנסות שוב.',
} as const;
