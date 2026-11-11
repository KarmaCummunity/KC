// Hebrew copy for the baseline reasons of the posts, handoffs and worlds RPCs (supabase/schemas
// 20_posts, 25_handoffs, 70_worlds). Merged into `marketplace.errors` next to
// donations.marketplaceErrors.ts; keys mirror MARKETPLACE_SERVER_ERROR_CODES in @kc/domain.
export const marketplaceBaselineErrorsHe = {
  declaration_required: 'כדי להציע נסיעה יש לאשר קודם את הצהרת הנהג.',
  ride_seats_below_bookings: 'כבר הוזמנו יותר מקומות מהמספר החדש.',
  not_ride_offer: 'אפשר להזמין מקום רק בהצעת נסיעה.',
  ride_series_schedule_invalid: 'לוח הזמנים של הטרמפ הקבוע אינו תקין. בדקו את השעה, הימים ותאריך הסיום.',
  event_time_invalid: 'האירוע צריך להתחיל בעתיד ולהסתיים אחרי שהוא מתחיל.',
  event_capacity_below_registrations: 'כבר נרשמו לאירוע יותר משתתפים מהמספר החדש.',
  event_message_invalid: 'כתבו הודעה לנרשמים, עד 500 תווים.',
  food_expiry_in_past: 'מועד התפוגה כבר עבר. בחרו תאריך ושעה עתידיים.',
  knowledge_slots_limit: 'אפשר להוסיף עד 20 מועדים.',
  housing_active_booking_conflict: 'יש אירוחים מאושרים שכבר תופסים את המקום הזה, ולכן אי אפשר לצמצם אותו עכשיו.',
  handoff_already_rated: 'כבר דירגתם את המסירה הזו. תודה!',
  handoff_world_not_supported: 'הפעולה הזו מתאימה רק למסירה של חפץ או מזון.',
  emergency_not_active: 'אפשר לקרוא לעזרה רק במהלך נסיעה או אירוח שאתם חלק מהם.',
  post_details_mismatch: 'פרטי הפוסט לא מתאימים לסוג שלו. בדקו את השדות ונסו שוב.',
  post_details_not_supported: 'אי אפשר לפרסם את סוג הפוסט הזה מהטופס הזה.',
  post_details_required: 'חסרים פרטים בפוסט. מלאו את כל השדות ונסו שוב.',
  post_kind_not_allowed: 'סוג הפוסט הזה אינו זמין כרגע. בחרו סוג אחר.',
  post_limit_exceeded: 'יש לכם כבר 20 פוסטים פעילים. סגרו או מחקו אחד לפני פרסום חדש.',
  post_not_found: 'הפוסט הזה כבר לא קיים.',
  consent_version_stale: 'הנוסח עודכן. קראו את הגרסה החדשה ואשרו שוב.',
  rate_limited: 'יותר מדי ניסיונות ברצף. נסו שוב בעוד רגע.',
  unauthenticated: 'צריך להתחבר מחדש כדי להמשיך.',
} as const;
