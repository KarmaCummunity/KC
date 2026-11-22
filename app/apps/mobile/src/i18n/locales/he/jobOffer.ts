// Hebrew — a job offer's organization in the create form (§5.11, #1476) and detail copy (#2537).
export const jobOffer = {
  create: {
    orgRequired: 'בחרו את הארגון שמציע את המשרה',
    noEligibleOrg: 'הצעת עבודה מתפרסמת רק בשם ארגון שאושר לפרסם משרות. מחפשים עבודה? פרסמו "מחפש/ת עבודה".',
  },
  detail: {
    title: 'פרטי המשרה',
    requirements: 'דרישות משרה',
    salary: 'שכר משוער',
  },
  salary: {
    amountHourly: '₪{{amount}} לשעה',
    amountMonthly: '₪{{amount}} לחודש',
    rangeHourly: '₪{{min}}–{{max}} לשעה',
    rangeMonthly: '₪{{min}}–{{max}} לחודש',
  },
  errors: {
    salaryPeriodRequired: 'בחרו תקופת שכר',
    salaryAmountRequired: 'הזינו שכר משוער',
    salaryRangeInverted: 'השכר הנמוך לא יכול להיות גבוה מהגבוה',
    salaryOutOfRange: 'הזינו שכר בטווח המותר',
  },
} as const;
