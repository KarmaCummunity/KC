// FR-AUTH-010 AC2.d — private date of birth (18+).
export const dateOfBirthHe = {
  label: 'תאריך לידה',
  helper: 'פרטי ולא מוצג לאף אחד. הגיל המינימלי הוא 18.',
  day: 'יום',
  month: 'חודש',
  year: 'שנה',
  errors: {
    underage: 'השימוש בקהילה הוא מגיל 18 ומעלה.',
    invalid: 'תאריך הלידה לא תקין.',
  },
  gate: {
    title: 'עוד פרט אחד לפני שממשיכים',
    subtitle: 'כדי להמשיך צריך תאריך לידה. הוא נשמר באופן פרטי.',
    save: 'שמירה והמשך',
  },
} as const;
