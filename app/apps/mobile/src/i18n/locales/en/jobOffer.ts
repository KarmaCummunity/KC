// English — a job offer's organization in the create form (§5.11, #1476) and detail copy (#2537).
export const jobOffer = {
  create: {
    orgRequired: 'Choose the organization offering the job',
    noEligibleOrg: 'A job offer is published only for an organization approved to post jobs. Looking for work? Post "looking for work" instead.',
  },
  detail: {
    title: 'Job details',
    requirements: 'Job requirements',
    salary: 'Estimated salary',
  },
  salary: {
    amountHourly: '₪{{amount}} / hour',
    amountMonthly: '₪{{amount}} / month',
    rangeHourly: '₪{{min}}–{{max}} / hour',
    rangeMonthly: '₪{{min}}–{{max}} / month',
  },
  errors: {
    salaryPeriodRequired: 'Choose a pay period',
    salaryAmountRequired: 'Enter an estimated salary',
    salaryRangeInverted: 'The lower salary cannot be above the higher one',
    salaryOutOfRange: 'Enter a salary within the allowed range',
  },
} as const;
