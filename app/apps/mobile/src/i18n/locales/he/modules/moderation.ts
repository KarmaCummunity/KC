// FR-MOD-007/010 + FR-ADMIN-002..007 — moderation strings (TD-35 file-size budget).
export const moderationHe = {
  report: {
    user: {
      title: 'דווחו על משתמש',
      reasonLabel: 'סיבת הדיווח',
      noteLabel: 'הערה (אופציונלי, עד 500 תווים)',
      submit: 'שלחו דיווח',
      successTitle: 'הדיווח נשלח',
      successToast: '✅ הדיווח התקבל. הצוות שלנו יבדוק.',
      duplicateTitle: 'כבר דיווחת',
      duplicateError: 'כבר דיווחת על משתמש זה ב-24 השעות האחרונות.',
      alreadyModeratedTitle: 'הטיפול כבר נעשה',
      alreadyModeratedError: 'המשתמש כבר טופל על ידי המנהלים. תודה על העזרה.',
      errorTitle: 'שגיאה',
    },
  },
  reasons: {
    spam: 'ספאם',
    offensive: 'תוכן פוגעני',
    misleading: 'מטעה',
    illegal: 'בלתי-חוקי',
    other: 'אחר',
  },
  ban: {
    title: 'חסימת משתמש',
    reasonLabel: 'סיבת החסימה',
    reasons: {
      spam: 'ספאם',
      harassment: 'הטרדה',
      policy_violation: 'הפרת מדיניות',
      other: 'אחר',
    },
    noteLabel: 'הערות נוספות',
    submit: 'חסום',
    confirmCopy: 'פעולה זו לצמיתות ואינה ניתנת לביטול. להמשיך?',
    successToast: 'המשתמש נחסם.',
  },
  suspendedBanner: {
    body: 'החשבון שלך מושעה כרגע: אפשר לגלוש, אבל לא לפרסם או לשלוח הודעות. אפשר לפנות לתמיכה.',
    contactSupport: 'פנייה לתמיכה',
  },
  bubble: {
    reportReceived: {
      title: 'דיווח התקבל',
      body: 'דיווח על {target_type} · {reason} · {count}/3',
    },
    autoRemoved: {
      title: 'הוסר אוטומטית',
      body: '{target_type} הוסר לאחר 3 דיווחים',
    },
    modActionTaken: {
      body: '✅ טופל ע״י אדמין · {action} · {time}',
    },
    ownerHiddenForReview: {
      body: 'הפוסט שלך הוסתר בעקבות דיווחים חוזרים וממתין לבדיקת צוות. נעדכן אותך כאן.',
    },
    ownerAutoRemoved: {
      body: 'הפוסט שלך הוסר אוטומטית בעקבות דיווחים חוזרים. אם זו טעות, ניתן לערער דרך כתובת התמיכה.',
    },
    donationLinkReported: {
      title: 'דיווח על קישור תרומה',
      a11yOpen: 'פתחו קישור: {name}',
    },
    targetPreview: {
      open: 'פתחו',
      postLabel: 'פוסט',
      profileLabel: 'פרופיל',
      hasImage: '📷 כולל תמונה',
      reporterNoteLabel: 'הערת מדווח:',
      evidenceLabel: 'צילום מצב מרגע הדיווח',
      chatNote: 'דיווח על שיחה — מוצג הצד השני',
      a11yOpenPost: 'פתחו פוסט מאת {who}',
      a11yOpenProfile: 'פתחו פרופיל של {who}',
    },
  },
  block: {
    block: 'חסימת משתמש',
    unblock: 'ביטול חסימה',
    confirmBlockTitle: 'לחסום את המשתמש?',
    confirmBlockBody: 'לא תראו זה את הפוסטים, המודעות והפרופיל של זה, לא תוכלו לשלוח הודעות זה לזה, והמעקב ביניכם יוסר. המשתמש לא יקבל הודעה על כך.',
    confirmUnblockTitle: 'לבטל את החסימה?',
    confirmUnblockBody: 'תוכלו לראות שוב זה את זה. מעקב שהוסר בגלל החסימה לא יחזור.',
    blockedToast: 'המשתמש נחסם.',
    unblockedToast: 'החסימה בוטלה.',
    // FR-MOD-004 AC1 — the Blocked Users screen (Settings).
    listTitle: 'משתמשים חסומים',
    listHint: 'מי שחסמתם לא רואה אתכם ואתם לא רואים אותו. ביטול חסימה מחזיר את הנראות, אבל לא את המעקב.',
    listEmpty: 'לא חסמתם אף אחד.',
    listError: 'לא הצלחנו לטעון את הרשימה. נסו שוב.',
    unnamedUser: 'משתמש',
    failed: 'משהו השתבש. נסו שוב.',
  },
  actions: {
    restore: '↩ שחזרו',
    dismiss: '🗑 דחה דיווח',
    confirm: '✓ אשר הסרה',
    ban: '🚫 חסום משתמש',
    removePost: '🗑 הסירו פוסט',
    deleteMessage: '🗑 מחקו הודעה',
    cancel: 'ביטול',
    proceed: 'המשך',
    confirmModal: {
      restore: 'פעולה זו תסמן את הדיווחים על המטרה כשגויים, מה שעלול לגרור סנקציה לרֶפּוֹרְטֵרים. להמשיך?',
      dismiss: 'סמנו דיווח זה כשגוי. אין השפעה על דיווחים אחרים. להמשיך?',
      confirm: 'אשר את ההסרה האוטומטית כהפרה ודאית. להמשיך?',
      ban: 'פעולה זו לצמיתות ואינה ניתנת לביטול. להמשיך?',
      removePost: 'הסירו פוסט זה כאדמין. להמשיך?',
      deleteMessage: 'מחקו הודעה זו לצמיתות. להמשיך?',
    },
    success: {
      restore: 'המטרה שוחזרה.',
      dismiss: 'הדיווח נדחה.',
      confirm: 'הדיווח אושר.',
      ban: 'המשתמש נחסם.',
      removePost: 'הפוסט הוסר.',
      deleteMessage: 'ההודעה נמחקה.',
    },
    errors: {
      forbidden: 'אין לך הרשאה לפעולה זו.',
      invalidRestoreState: 'לא ניתן לשחזר את המטרה במצבה הנוכחי.',
      invalidTargetState: 'הפעולה אינה אפשרית במצבו הנוכחי של היעד.',
      reportNotOpen: 'הדיווח כבר טופל.',
      invalidSanctionReason: 'סיבת הסנקציה אינה תקפה.',
      cannotSanctionSelf: 'אי אפשר להחיל סנקציה על עצמכם.',
      cannotSanctionAdmin: 'אי אפשר להחיל סנקציה על איש צוות. בטלו קודם את התפקיד שלו.',
      accountPendingDeletion: 'החשבון בתהליך מחיקה, ולכן אי אפשר להחיל עליו סנקציה.',
      targetNotFound: 'היעד לא נמצא.',
      messageNotFound: 'ההודעה לא נמצאה.',
      networkError: 'תקלה ברשת. נסו שוב.',
    },
  },
  supportIssueBubble: {
    title: 'פנייה לתמיכה',
    issueRef: 'מזהה פנייה:',
    categoryLabel: 'קטגוריה:',
  },
} as const;

export const auditHe = {
  title: 'אאודיט',
  searchPlaceholder: 'חפשו משתמש לפי שם...',
  noResults: 'אין תוצאות.',
  loading: 'טוען...',
  metadataLabel: 'מטא-דאטה',
  rowAction: {
    block_user: 'חסימה',
    unblock_user: 'ביטול חסימה',
    report_target: 'דיווח',
    auto_remove_target: 'הסרה אוטומטית',
    manual_remove_target: 'הסרה ידנית',
    restore_target: 'שחזור',
    suspend_user: 'השעיה',
    unsuspend_user: 'החזרה לפעילות',
    ban_user: 'חסימה לצמיתות',
    false_report_sanction_applied: 'סנקציה על דיווחי שווא',
    dismiss_report: 'דחיית דיווח',
    confirm_report: 'אישור דיווח',
    delete_message: 'מחיקת הודעה',
  },
} as const;

export const accountBlockedHe = {
  supportMail: {
    subject: 'פנייה ממשתמש/ת — חשבון מוגבל (קהילת קארמה)',
    body:
      'שלום צוות קארמה,\n\n' +
      'אני פונה בנוגע למצב החשבון שלי באפליקציה.\n\n' +
      'תיאור קצר:\n\n' +
      '————————————\n' +
      '(מלא/י כאן)\n',
  },
  banned: {
    title: 'החשבון נחסם לצמיתות',
    body: 'החשבון שלך נחסם בעקבות הפרת מדיניות הקהילה.',
    cta: 'יצירת קשר',
  },
  suspendedAdmin: {
    title: 'החשבון הושעה',
    body: 'המוֹדֶרציָה השעתה את החשבון שלך עד לבירור.',
    cta: 'ערעור',
  },
  suspendedForFalseReports: {
    title: 'החשבון מושעה זמנית',
    body: 'החשבון שלך מושעה עד {until} עקב 5 דיווחים שגויים ב-30 הימים האחרונים.',
    cta: 'ערעור מוקדם',
  },
} as const;
