// FR-PROFILE / FR-FOLLOW strings extracted from the main bundle to keep
// `index.ts` under the 200-LOC cap as the profile surface grows (TD-156).
export const profileHe = {
  myProfile: 'הפרופיל שלי',
  editProfile: 'לערוך פרופיל',
  shareProfile: 'לשתף פרופיל',
  followers: 'עוקבים',
  following: 'במעקב',
  activePosts: 'פוסטים פעילים',
  closedPosts: 'פוסטים שנמסרו',
  follow: 'לעקוב',
  following_btn: 'מעקב פעיל ✓',
  requestSent: 'בקשה נשלחה ⏳',
  sendMessage: 'לשלוח הודעה',
  privateProfile: '🔒 הפרופיל פרטי. אפשר לשלוח בקשת עקיבה כדי לראות פוסטים.',

  // Follow button states + confirm dialogs (FR-FOLLOW-011)
  followCta: '+ לעקוב',
  followingActive: 'עוקב ✓',
  followRequestCta: '+ לשלוח בקשה',
  unfollowConfirmTitle: 'להפסיק לעקוב?',
  unfollowConfirmCta: 'להפסיק לעקוב',
  cancelRequestTitle: 'לבטל את בקשת המעקב?',
  cancelRequestBody: 'אפשר לשלוח בקשה חדשה בכל עת.',
  cancelRequestCta: 'לבטל בקשה',
  cooldownRetryDays: 'ניתן לשלוח שוב בעוד {{days}} ימים',
  followUnavailable: 'המשתמש לא זמין למעקב כרגע',

  // Header / framing
  privateProfileA11y: 'פרופיל פרטי',
  headerTitle: 'פרופיל',
  // FR-PROFILE / migration 0084 — fallbacks when a User row is in the
  // `pending_basic_info` transient window and `display_name` / `city_name`
  // are still NULL in the DB. Render sites use `value ?? t('profile.fallbackName')`
  // / `value ?? t('profile.cityNotSet')`.
  fallbackName: 'משתמש',
  cityNotSet: '—',
  userNotFound: 'משתמש לא נמצא',

  // Tabs
  tabOpen: 'פוסטים פתוחים',
  tabClosed: 'פוסטים סגורים',
  tabOpenWithCount: 'פתוחים ({{count}})',
  tabClosedWithCount: 'סגורים ({{count}})',

  // My Profile top-bar ⋮ (admin-removed posts — FR-POST-008 owner list)
  myProfileMenuA11y: 'אפשרויות פרופיל',
  myProfileMenuHiddenPosts: 'מוסתרים',
  myProfileMenuRemovedPosts: 'פוסטים שהוסרו על ידי מנהל',
  hiddenBanner: 'פוסטים אלה מוצגים רק לך. הם לא מופיעים בטאבים הפתוחים או הסגורים בפרופיל.',
  hiddenSectionOpen: 'פוסטים פתוחים',
  hiddenSectionClosed: 'פוסטים סגורים',
  emptyHiddenOpenTitle: 'אין פוסטים מוסתרים פתוחים',
  emptyHiddenOpenSubtitle: 'כשתפרסמי פוסט שמוצג רק לך, הוא יופיע כאן.',
  emptyHiddenClosedTitle: 'אין פוסטים מוסתרים סגורים',
  emptyHiddenClosedSubtitle: 'פוסטים מוסתרים שסגרת יופיעו כאן.',
  myProfileMenuSavedPosts: 'שמורים',
  savedBanner: 'פוסטים ששמרת. אם פוסט אינו זמין עוד (נמחק, הוסר, או חזר להיות פרטי) הוא לא יוצג כאן.',
  savedSectionOpen: 'פוסטים פתוחים',
  savedSectionClosed: 'פוסטים סגורים',
  emptySavedOpenTitle: 'אין פוסטים פתוחים בשמורים',
  emptySavedOpenSubtitle: 'אפשר לשמור פוסט פתוח מהפיד כדי לראות אותו כאן.',
  emptySavedClosedTitle: 'אין פוסטים סגורים בשמורים',
  emptySavedClosedSubtitle: 'פוסטים סגורים ששמרת יופיעו כאן.',

  // Stats row
  statsPostsLabel: 'פוסטים',

  // Empty states
  emptyOpenTitle: 'אין פוסטים פתוחים',
  emptyClosedTitle: 'אין פוסטים סגורים',
  emptyClosedTitleSelf: 'אין פוסטים סגורים עדיין',
  emptySelfOpenSubtitle: 'לפרסם את הפוסט הראשון שלך!',
  emptySelfClosedSubtitle: 'פוסטים שסגרת או שקיבלת יופיעו כאן.',
  emptySelfClosedSubtitleLegacy: 'פוסטים שסגרת כ-נמסר יופיעו כאן.',
  emptyOtherOpenSubtitle: 'משתמש זה עוד לא פרסם פוסטים.',
  emptyOtherClosedSubtitle: 'משתמש זה עוד לא סגר ולא קיבל פוסט.',
  emptyOtherClosedSubtitleLegacy: 'משתמש זה עוד לא סיים מסירה.',
  followCooldownTitle: 'לא ניתן לשלוח כרגע',
  followCooldownDays: 'ניתן לשלוח שוב בעוד {{count}} ימים.',
  followErrorTitle: 'שגיאה',
  followErrorMessage: 'הפעולה נכשלה. נסו שוב.',
  followRateLimited: 'יותר מדי בקשות מעקב. נסו שוב עוד מעט.',
  followAccountNotActive: 'החשבון שלך עדיין לא פעיל, ולכן אי אפשר לעקוב אחרי חברים כרגע.',

  // Avatar editor (EditProfileAvatar — FR-PROFILE-007)
  avatarChangeA11y: 'החלפת תמונת פרופיל',
  avatarAddA11y: 'הוספת תמונת פרופיל',
  avatarChangeHint: 'להחליף תמונה',
  avatarAddHint: 'להוסיף תמונה',
  avatarUploadFailedTitle: 'העלאת התמונה נכשלה',
  avatarUploadRetry: 'אפשר לנסות שוב.',

  // PhotoSourceSheet (FR-AUTH-011 AC1)
  photoSourceTitle: 'תמונת פרופיל',
  photoSourceCameraOption: '📷  צלם תמונה',
  photoSourceCameraA11y: 'צילום במצלמה',
  photoSourceGalleryOption: '🖼️  לבחור מהגלריה',
  photoSourceGalleryA11y: 'בחירה מהגלריה',
  photoSourceRemoveOption: '🗑️  להסיר תמונה',
  photoSourceRemoveA11y: 'הסרת התמונה הנוכחית',

  // CityPicker (FR-AUTH-010 AC2 — also reused by EditProfileAddressBlock)
  cityPickerTitle: 'לבחור עיר',
  cityPickerSearchPlaceholder: '...חיפוש עיר',
  cityPickerError: 'שגיאה בטעינת רשימת הערים. אפשר לנסות שוב.',
  cityPickerEmpty: 'לא נמצאו ערים תואמות.',
  cityPickerCloseA11y: 'סגור',

  // StreetPicker (FR-PROFILE-007 AC1 — city-dependent canonical streets)
  streetPickerTitle: 'בחרו רחוב',
  streetPickerSearchPlaceholder: '...חיפוש רחוב',
  streetPickerError: 'שגיאה בטעינת רשימת הרחובות. נסו שוב.',
  streetPickerEmpty: 'לא נמצאו רחובות תואמים.',
  streetPickerNeedCity: 'בחרו עיר תחילה',
  streetPickerUseMyText: 'השתמשו ב־"{{value}}"',

  // EditProfileAddressBlock
  addressLabel: 'כתובת',
  streetNumberShort: 'מס׳',

  // Removed-tab banner (FR-POST-008 owner-view of removed_admin posts)
  removedBanner: 'פוסטים אלה הוסרו על ידי מנהל הקהילה. הם גלויים רק לך.',
  removedSectionOpen: 'פוסטים שהיו פתוחים',
  removedSectionClosed: 'פוסטים שהיו סגורים',
  emptyRemovedOpenTitle: 'אין פוסטים פתוחים שהוסרו',
  emptyRemovedOpenSubtitle: 'פוסטים פתוחים שיוסרו על ידי מנהל יופיעו כאן.',
  emptyRemovedClosedTitle: 'אין פוסטים סגורים שהוסרו',
  emptyRemovedClosedSubtitle: 'פוסטים סגורים שיוסרו על ידי מנהל יופיעו כאן.',

  // Edit Profile screen (FR-PROFILE-007)
  editScreen: {
    loadFailedTitle: 'טעינה נכשלה',
    saveFailedTitle: 'שמירה נכשלה',
    unknownError: 'שגיאה לא ידועה',
    unsavedChangesTitle: 'יש שינויים שלא נשמרו',
    unsavedChangesMessage: 'אם תצא עכשיו השינויים יאבדו. לצאת בכל זאת?',
    unsavedChangesDiscard: 'צא בלי לשמור',
    unsavedChangesCancel: 'ביטול',
    invalidNameTitle: 'שם לא תקין',
    invalidNameMessage: 'נא להזין שם בין 1 ל־50 תווים.',
    missingCityTitle: 'עיר חסרה',
    missingCityMessage: 'נא לבחור עיר.',
    incompleteAddressTitle: 'כתובת לא מלאה',
    incompleteAddressMessageNumber: 'נא למלא גם מספר בית, או למחוק את שם הרחוב.',
    incompleteAddressMessageStreet: 'נא למלא שם רחוב, או למחוק את מספר הבית.',
    fullNameLabel: 'שם מלא',
    fullNamePlaceholder: 'לדוגמה: רינה כהן',
    contactPhoneLabel: 'טלפון ליצירת קשר',
    contactPhoneHelper: 'נדרש לתג «פרופיל מלא» (לא אימות טלפון).',
    contactPhonePlaceholder: 'לדוגמה: 050-1234567',
    completeProfileCardTitle: 'חסרים פרטים לתג פרופיל מלא',
    completeProfileCardBody: 'מלאו את הסעיפים הבאים ושמרו — יופיע סימן ירוק ליד השם.',
    completeField: {
      bullet: '• {{field}}',
      displayName: 'שם מלא',
      city: 'עיר',
      dateOfBirth: 'תאריך לידה (פרטי)',
      avatarUrl: 'תמונת פרופיל',
      profileStreet: 'רחוב',
      profileStreetNumber: 'מספר בית',
      contactPhone: 'טלפון ליצירת קשר',
    },
    invalidContactPhoneTitle: 'מספר טלפון לא תקין',
    invalidContactPhoneMessage: 'יש להזין עד 20 תווים.',
    biographyLabel: 'ביוגרפיה (אופציונלי)',
    biographyPlaceholder: 'קצת עליך — בלי קישורים',
    save: 'לשמור',
  },

  // Other user's profile (FR-PROFILE-002..004)
  otherScreen: {
    headerTitle: 'פרופיל',
    userNotFound: 'משתמש לא נמצא',
    sendMessage: 'לשלוח הודעה',
  },

  // Followers list (FR-PROFILE-009 / FR-PROFILE-010)
  followersScreen: {
    headerTitle: 'עוקבים',
    searchPlaceholder: 'חיפוש לפי שם',
    empty: 'אין תוצאות',
    removeFollowerTitle: 'להסיר עוקב?',
    removeFollowerMessage:
      '{{name}} לא יראה יותר פוסטים שיועדו לעוקבים בלבד, ולא יקבל על כך הודעה. אם הפרופיל שלך פתוח הם יוכלו לעקוב מחדש מיד; אם הוא פרטי — יצטרכו לשלוח בקשה.',
    removeFollowerConfirm: 'להסיר',
  },

  // Following list (FR-PROFILE-010)
  followingScreen: {
    headerTitle: 'נעקבים',
    searchPlaceholder: 'חיפוש לפי שם',
    empty: 'אין תוצאות',
  },
} as const;
