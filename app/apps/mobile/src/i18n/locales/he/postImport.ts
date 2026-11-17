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
} as const;
