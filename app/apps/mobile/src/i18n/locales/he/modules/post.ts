// FR-POST strings split from main bundle (TD-35 file-size budget).
// `editPost` lives in postEdit.ts; menu/report in their own modules.
// TD-117 closed by extracting editPost into postEdit.ts.
import { postMenuHe } from './postMenu';
import { postReportHe } from './postReport';
import { postEditHe } from './postEdit';
import { postUnifiedCreateHe } from './postUnifiedCreate';

export const postHe = {
  ...postMenuHe,
  ...postReportHe,
  ...postEditHe,
  ...postUnifiedCreateHe,
  give: 'לתת חפץ',
  request: 'לבקש חפץ',
  title: 'כותרת',
  titlePlaceholder: 'מה נותנים או מבקשים?',
  description: 'תיאור (אופציונלי)',
  descPlaceholder: 'פרטים נוספים על החפץ...',
  urgency: 'דחיפות (אופציונלי)',
  urgencyPlaceholder: 'לדוגמה: צריך עד שישי',
  photos: 'תמונות',
  addPhoto: 'הוסיפו תמונה',
  removePhoto: 'הסירו תמונה',
  sendMessageA11y: 'שלחו הודעה למפרסם',
  address: 'כתובת',
  cityLabel: 'עיר',
  streetLabel: 'רחוב',
  streetNumberLabel: 'מספר',
  locationDisplay: 'מה להציג בפיד',
  cityOnly: 'עיר בלבד',
  cityAndStreet: 'עיר + רחוב',
  fullAddress: 'כתובת מלאה',
  visibility: 'מי יראה את הפוסט',
  visibilityPublic: '🌍 כולם',
  visibilityFollowers: '👥 רק העוקבים שלי',
  visibilityOnlyMe: '🔒 רק אני',
  publish: 'פרסמו',
  draft: 'שמרו טיוטה',
  publishSuccess: 'הפוסט שלך פורסם!',
  draftRestored: 'יש לך טיוטה שלא פורסמה',
  draftRestoredBody: 'התחלת לכתוב פוסט ולא פרסמת אותו. להמשיך מאיפה שעצרת או להתחיל מחדש?',
  draftMissingImage: 'התמונה אינה זמינה — הוסיפו שוב.',
  continueDraft: 'המשך לערוך',
  discardDraft: 'התחילו מחדש',
  sendMessage: '💬 שלחו הודעה למפרסם',
  followAuthor: 'עקבו אחרי המפרסם',
  report: 'דווחו',
  markDelivered: 'סמנו כ-נמסר',
  edit: 'ערכו',
  delete: 'מחקו',
  reopen: '📤 פתחו מחדש',
  conditionNew: 'חדש',
  conditionLikeNew: 'כמו חדש',
  conditionGood: 'טוב',
  conditionFair: 'בינוני',
  photoRequired: 'תמונה נדרשת עבור פוסט "לתת"',
  maxPhotos: 'מקסימום {{max}} תמונות',
  maxPosts: 'הגעת למקסימום 20 פוסטים פעילים',
  imageZoom: 'הגדל תמונה',
  imageZoomNth: 'הגדל תמונה {{index}} מתוך {{total}}',
  imageViewerClose: 'סגור תצוגת תמונה',

  // FR-POST-003 — LocationDisplayLevelChooser (publish-address granularity)
  locationDisplayLabel: 'תצוגת הכתובת',
  locationDisplayCityAndStreet: 'עיר ורחוב',
  locationDisplayHintCityOnly: 'אנונימיות מרבית',
  locationDisplayHintCityAndStreet: 'מומלץ',
  locationDisplayHintFullAddress: 'כולל מספר בית',

  // PhotoPicker
  photosRequiredSuffix: '* (חובה עבור "לתת")',
  photosHint: 'בחרו עד {{max}} תמונות מהגלריה.',

  // VisibilityChooser sub-labels (FR-POST-003)
  visibilityPublicSub: 'הפוסט יוצג בפיד הראשי לכל המשתמשים',
  visibilityFollowersSub: 'הפוסט יוצג רק לעוקבים מאושרים שלך',
  visibilityOnlyMeSub: 'הפוסט נשמר באופן פרטי; אפשר לפתוח לציבור בעריכה',
  // FR-POST-003 AC5 — public profile: Followers-only row hint (tooltip copy as subtitle).
  visibilityFollowersLockedSub: 'זמין בפרופיל פרטי. הגדרות ← פרטיות.',
  deleteError: 'המחיקה נכשלה, נסה שוב.',
  deleteSuccess: 'הפוסט נמחק.',
  adminRemoveError: 'ההסרה נכשלה, נסה שוב.',
  adminRemoveSuccess: 'הפוסט הוסר.',

  // Category labels — keys match the `Category` enum so callers do
  // `t(\`post.category.${cat}\`)`. Moved out of domain/value-objects.ts
  // per the Hebrew→i18n migration (Pattern #2).
  category: {
    Furniture: 'רהיטים',
    Clothing: 'בגדים',
    Books: 'ספרים',
    Toys: 'משחקים',
    BabyGear: 'ציוד תינוקות',
    Kitchen: 'מטבח',
    Sports: 'ספורט',
    Electronics: 'חשמל',
    Tools: 'כלי עבודה',
    Other: 'אחר',
  },

  // Item-condition labels — keys match the `ItemCondition` enum so callers
  // do `t(\`post.condition.${cond}\`)`. Moved out of domain/value-objects.ts.
  condition: {
    New: 'חדש',
    LikeNew: 'כמו חדש',
    Good: 'טוב',
    Fair: 'בינוני',
    Damaged: 'שבור/תקול',
  },

  // PR5d (UI sweep, Pattern #1) — header titles + create-screen literals
  // not covered by the existing keys above. Add a new key only when no
  // sibling already covers the exact Hebrew string.
  detailTitle: 'פרטי פוסט',
  streetNumberShort: 'מס׳',
  // FR-KARMA-004 — compact estimated-value hint shown on the feed post card (Give posts).
  estimatedValueBadge: 'שווי משוער ₪{{value}}',
  categoryLabel: 'קטגוריה',
  conditionLabel: 'מצב החפץ',
  reauthRequired: 'יש להתחבר מחדש לפני פרסום פוסט.',
  uploadFailedTitle: 'העלאת התמונה נכשלה',
  uploadRetry: 'נסו שוב.',
  uploadPartial: '{{ok}}/{{total}} הועלו — נסו שוב את היתר.',
  networkError: 'שגיאת רשת. נסו שוב.',
  publishFailed: 'פרסום נכשל: {{message}}',

  // FR-POST-006 AC2 — publish with Followers-only visibility (create flow).
  publishFollowersTitle: 'לפרסם רק לעוקבים מאושרים?',
  publishFollowersBody:
    'הפוסט יופיע בפיד של עד {{count}} עוקבים מאושרים (לפי המונה בפרופיל).',
  publishFollowersConfirmCta: 'רק עוקבים',
  publishFollowersMakePublicCta: 'הפכו לציבורי',

  /** Collapsible block on create post — address display, visibility, partner-surface mask. */
  exposureSettingsSectionTitle: 'הגדרות חשיפה',
  exposureSettingsIntro:
    'כאן בוחרים מה ייראה בפיד. הכתובת המלאה נדרשת לפרסום, אבל לא חייבת להיות גלויה לכולם.',
  menuExposureClosedHint:
    'פוסט סגור: כאן מגדירים מי רואה את הכרטיס בפרופיל של המתאם (בנפרד מנראות בפיד).',
  menuExposureSaving: 'שומר…',

  /** FR-POST-021 + D-31 — third-party viewers on the partner's closed-post profile (not the partner in chat). */
  counterpartyMaskLabel: 'להסתיר את הזהות שלי מצופים אחרים ב״פוסטים סגורים״ של המתאם',
  createCounterpartyPrivacyTitle: 'מי רואה אותי ליד הפוסט אצל המתאם?',
  createCounterpartyPrivacyHint:
    'בצ׳אט המתאם כבר רואה מי כותב לו. כאן מדובר במשתמשים שלישיים שנכנסים לרשימת הפוסטים הסגורים בפרופיל של המתאם — הם לא ייראו את השם והתמונה שלך בכרטיס הפוסט. בפיד ובמקומות אחרים זה לפי הגדרות הנראות למעלה.',

  // Post detail screen (post/[id].tsx) — PR5b i18n sweep.
  detail: {
    loadErrorTitle: 'שגיאה בטעינת הפוסט',
    retry: 'נסו שוב',
    notFoundTitle: 'הפוסט לא נמצא',
    notFoundSubtitle: 'ייתכן שהוא נסגר או שאין לך הרשאה לצפייה.',
    streetPrefix: 'רחוב',
    // FR-POST-023 — share post via link (P2.33).
    shareA11y: 'שתפו את הפוסט',
    shareDialogTitle: 'שיתוף פוסט',
    shareHeadlineGiveOpen: '🎁 חפץ שמחכה לבית חדש בקהילת קארמה',
    shareHeadlineGiveClosed: '✅ חפץ שנמסר בהצלחה בקהילת קארמה',
    shareHeadlineRequestOpen: '🔍 בקשה לעזרה מקהילת קארמה',
    shareHeadlineRequestClosed: '✅ בקשה שקיבלה מענה בקהילת קארמה',
    shareLabelTitle: 'כותרת:',
    shareLabelDescription: 'תיאור:',
    shareLabelCategory: 'קטגוריה:',
    shareLabelLocation: 'מיקום:',
    shareLabelPostedAt: 'פורסם:',
    shareLabelStatus: 'סטטוס:',
    shareLabelPublisher: 'מפרסם:',
    shareLabelCounterparty: 'שותף/ה:',
    shareCtaGiveOpen: 'אולי זה בדיוק בשבילכם — לחצו לפרטים 👇',
    shareCtaGiveClosed: 'לצפייה בפרטי המסירה — לחצו כאן 👇',
    shareCtaRequestOpen: 'אם תוכלו לעזור — לחצו לפרטים 👇',
    shareCtaRequestClosed: 'לצפייה בפרטי הבקשה — לחצו כאן 👇',
    shareCopiedToast: 'הקישור הועתק',
    shareFailedToast: 'השיתוף נכשל, נסה שוב.',
    typeGiveLabel: 'לתת',
    typeRequestLabel: 'לבקש',
    conditionPrefix: 'מצב: ',
    urgencyPrefix: '⚡ דחיפות: ',
    contactA11y: 'שלחו הודעה למפרסם',
    contactOpeningA11y: 'פותח שיחה עם המפרסם',
    contactCta: 'שלחו הודעה למפרסם',
    anonymousUser: 'אנונימי',
    statusOpen: 'פעיל',
    statusOpenHint: 'הפוסט פתוח ומחפש התאמה',
    statusClosed: 'הושלם',
    statusPendingDelete: 'נסגר זמנית',
    statusExpired: 'פג תוקף',
    statusRemovedAdmin: 'הוסר',
    publishedBy: 'פורסם על-ידי',
    // Visibility + lifecycle notices shown to anyone who can still see the post.
    removedAdminNotice: 'הפוסט הוסר על ידי מנהל ואינו מוצג בפיד.',
    statusHiddenForReview: 'מוסתר לבדיקה',
    hiddenForReviewNotice: 'הפוסט הוסתר בעקבות דיווחים וממתין לבדיקת צוות. הוא לא מוצג לאחרים בינתיים.',
    expiredNotice: 'הפוסט פג תוקף ואינו פעיל יותר.',
    visibilityFollowersNotice: 'פוסט זה גלוי לעוקבים מאושרים בלבד.',
    visibilityOnlyMeNotice: 'פוסט פרטי — גלוי רק לבעליו.',
  },

  // FR-TRANSLATE-003 — translation reader UX
  translating: 'מתרגם…',
  showOriginal: 'הציגו מקור',
  showTranslation: 'הציגו תרגום',
  autoTranslated: 'תורגם אוטומטית',

  engagement: {
    title: 'תגובות',
    meta: '{{reactions}} רגשות · {{comments}} תגובות',
    commentPlaceholder: 'כתוב תגובה…',
    commentSend: 'פרסמו תגובה',
    reaction: {
      like: 'אהבתי',
      support: 'תמיכה',
      thanks: 'תודה',
    },
  },
} as const;
