// Import a post from a message (FR-IMPORT-001, FR-IMPORT-007): the paste screen and its entry in
// the create form. The member confirms the post is their own before a draft is made (S90).
export const postImport = {
  entry: 'ייבוא מהודעה',
  entryHint: 'יש לכם פוסט שכבר פרסמתם בקבוצה? הדביקו אותו ונכין ממנו טיוטה.',
  screenTitle: 'ייבוא מהודעה',
  intro: 'הדביקו כאן פוסט שפרסמתם בקבוצה או באתר אחר. נכין ממנו טיוטה, ואתם תבדקו ותתקנו לפני הפרסום.',
  textLabel: 'ההודעה',
  textPlaceholder: 'הדביקו כאן את הטקסט של הפוסט',
  ownLabel: 'זה הפוסט שלי: אני זה שנותן או מבקש',
  ownHint: 'אפשר לייבא רק פוסט שכתבתם בעצמכם. פוסט של מישהו אחר לא נכנס ל-KC בדרך הזו.',
  privacyNote: 'טלפונים, כתובות מייל וקישורים מוסרים מהטקסט לפני העיבוד.',
  submit: 'הכנת טיוטה',
  working: 'מכינים טיוטה',
  close: 'סגירה',
  // The notice above the create form after an import (FR-IMPORT-007 AC2).
  reviewTitle: 'הטופס מולא מתוך ההודעה שהדבקתם. בדקו אותו לפני הפרסום.',
  reviewRemoved: 'הסרנו מהטקסט פרטי קשר כמו טלפון ומייל. בצ\'אט של KC אפשר לתאם בלי לחשוף אותם.',
  reviewTruncated: 'ההודעה ארוכה, ולכן קראנו רק את ההתחלה שלה.',
  reviewDuplicate: 'כבר יש לכם פוסט פתוח דומה. אפשר לפרסם שוב, או להשאיר את הקיים.',
  reviewDuplicateOpen: 'לפוסט הקיים',
  reviewCheck: 'כדאי לבדוק במיוחד: {{fields}}',
  fields: {
    world: 'תחום',
    direction: 'נותנים או מבקשים',
    subcategory: 'קטגוריה',
    title: 'כותרת',
    city: 'עיר',
    street: 'רחוב',
    time: 'מועד',
    origin: 'נקודת יציאה',
    destination: 'יעד',
  },
  // The chip on an imported post's card and detail (FR-IMPORT-007 AC3).
  provenance: {
    whatsapp: 'מוואטסאפ',
    facebook: 'מפייסבוק',
    yad2: 'מיד2',
    imported: 'יובא מבחוץ',
  },
  // Why no draft was made (FR-IMPORT-008 AC3-AC4); the pasted text is in the description.
  limits: {
    rate_limited: 'הגעתם למספר הייבואים המותר כרגע. אפשר לנסות שוב מאוחר יותר, או למלא את הטופס בעצמכם.',
    budget_exhausted: 'הכנת טיוטה אוטומטית לא זמינה כרגע. הטקסט שהדבקתם נמצא בתיאור.',
    import_locked: 'הייבוא חסום אצלכם לזמן מה, כי כמה פוסטים שייבאתם הוסרו. אפשר לפרסם כרגיל.',
    account_too_new: 'ייבוא מהודעה אפשרי מיום אחרי ההרשמה. בינתיים אפשר לפרסם כרגיל.',
  },
} as const;
