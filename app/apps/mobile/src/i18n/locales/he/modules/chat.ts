// FR-CHAT-016 — chat strings split from main bundle (TD-35 file-size budget).
export const chatHe = {
  title: 'שיחות',
  noChats: 'אין שיחות עדיין',
  noChatsDesc: 'פנה למפרסמים ישירות מתוך הפוסטים.',
  inputPlaceholder: 'כתוב הודעה...',
  attachImage: 'צרף תמונה',
  mediaUploadFailed: 'לא ניתן לשלוח את התמונה. נסה שוב.',
  typingIndicator: 'מקליד/ה…',
  onlineNow: 'מחובר/ת עכשיו',
  send: 'שלח',
  read: 'נקרא',
  report: 'דווח על שיחה',
  menuDeleteFromInbox: 'הסר מהאינבוקס שלי',
  hideFromInboxTitle: 'להסיר את השיחה מהאינבוקס?',
  hideFromInboxBody:
    'השיחה תיעלם רק אצלך. אצל הצד השני נשארת ההיסטוריה. הודעה חדשה באותו שרשור עלולה להחזיר אותה לרשימה.',
  hideFromInboxCancel: 'ביטול',
  hideFromInboxConfirm: 'הסר',
  menuReport: 'דווח על השיחה',
  minutesAgoShort: "לפני {{count}} דק'",

  // InboxChatRow
  hideChatA11y: 'הסר שיחה מהאינבוקס',
  // Inbox preview prefixes — TD-110 bug 2.
  inboxSystemPrefix: '(הודעת מערכת)',
  inboxNewConversation: '(שיחה חדשה)',
  // Post-closure system messages (FR-CHAT-015 AC4-AC6, TD-148) — rendered from
  // system_payload; Hebrew matches the body the DB trigger (0031) stores.
  systemPostClosed: {
    deliveredToYou: 'הפוסט סומן כנמסר ✓ · תודה!',
    deliveredToOther: 'הפוסט נמסר למשתמש אחר',
    closedNotDelivered: 'המפרסם סגר את הפוסט — הפריט לא נמסר',
  },

  // AnchoredPostCard (FR-CHAT-014/015)
  anchoredOpenA11y: 'פתח את הפוסט',
  anchoredTypeGive: 'נותן',
  anchoredTypeRequest: 'מבקש',
  // AnchoredPostCard contact-phone quick-call (FR-CHAT-014 AC7)
  anchoredCallCounterpartA11y: 'התקשר אל {{phone}}',
  anchoredCallLabel: 'התקשר',

  // ReportChatModal (FR-CHAT-010)
  reportChatTitle: 'דיווח על השיחה',
  reportChatNotePlaceholder: 'תיאור (אופציונלי, עד 500 תווים)',
  reportChatDuplicateBody: 'דיווחת על השיחה הזו ב-24 השעות האחרונות.',
  reportChatSubmitting: '...',

  // Auto chat-message template — moved out of
  // application/chat/BuildAutoMessageUseCase.ts (Pattern #4). The wording
  // must match the use case's template exactly because contactPoster.ts
  // dedupes against the rendered string in the last 50 messages.
  autoMessage: {
    initial: 'היי! ראיתי את הפוסט שלך על {{title}}. אשמח שנדבר.',
    rideInitial: 'היי, פניתי בנוגע ל: {{title}}',
  },

  // Chat conversation screen (chat/[id].tsx) — PR5b i18n sweep.
  headerActionsA11y: 'פעולות',
  errorTitle: 'שגיאה',
  hideErrorSupport: 'לא ניתן להסיר את שיחת התמיכה.',
  hideErrorGeneric: 'לא הצלחנו להסיר את השיחה. נסה שוב.',

  // Chat inbox screen (chat/index.tsx) — PR5b i18n sweep.
  searchPlaceholder: 'חפש לפי שם...',

  // ChatNotFoundView (components/chat/ChatNotFoundView.tsx) — PR5b i18n sweep.
  notFoundTitle: 'השיחה לא זמינה',
  notFoundSubtitle: 'ייתכן שהשיחה נמחקה או שאין לך גישה אליה.',
  notFoundBack: 'חזרה',
} as const;
