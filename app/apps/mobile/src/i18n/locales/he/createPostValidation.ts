// Inline problems shown on the give / request form after a rejected Publish (FR-RESP-006 AC27).
export const createPostValidationHe = {
  missingTitle: 'יש למלא כותרת לפני פרסום.',
  missingPhoto: 'יש להוסיף לפחות תמונה אחת לפני פרסום.',
  linkUrlInvalid: 'יש להזין קישור שמתחיל ב-https://',
  linkNameShort: 'יש להזין שם של 2 תווים לפחות',
  linkDescriptionTooLong: 'התיאור ארוך מדי',
} as const;
