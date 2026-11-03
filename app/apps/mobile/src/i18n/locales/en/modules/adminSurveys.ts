// app/apps/mobile/src/i18n/locales/en/modules/adminSurveys.ts
// FR-ADMIN-021 — Admin Portal survey results & free-feedback dashboard.
export const adminSurveysEn = {
  title: 'Surveys & feedback',
  subtitle: 'Statistics and per-user responses',
  loading: 'Loading...',
  forbiddenTitle: 'You do not have permission to access survey data.',
  errorTitle: 'Something went wrong while loading the data.',
  retry: 'Try again',

  tabs: {
    surveys: 'Surveys',
    feedback: 'Free feedback',
  },

  overview: {
    emptyTitle: 'No active surveys',
    emptyHint: 'Published surveys will appear here with their response data.',
    respondents: (n: number) => `${n} respondents`,
    responses: (n: number) => `${n} responses`,
    questions: (n: number) => `${n} questions`,
    inactiveBadge: 'Inactive',
    lastResponse: (when: string) => `Last response: ${when}`,
    noResponses: 'No responses yet',
    versionLabel: (v: number) => `Version ${v}`,
  },

  stats: {
    sectionTitle: 'Statistics by question',
    avgLabel: 'Average',
    responsesLabel: 'Responses',
    noData: 'No data',
    choiceDistributionTitle: 'Choice distribution',
    distributionTitle: 'Rating distribution (1–7)',
  },

  respondents: {
    sectionTitle: 'Per-user responses',
    emptyTitle: 'No responses yet',
    anonymous: 'Unnamed user',
    submittedAt: (when: string) => `Submitted ${when}`,
    ratingLabel: (n: number) => `Rating: ${n}/7`,
    noText: '(no comment)',
  },

  feedback: {
    sectionTitle: 'Free feedback',
    emptyTitle: 'No feedback yet',
    emptyHint: 'Free feedback submitted by users will appear here.',
    anonymous: 'Unnamed user',
    ratingLabel: (n: number) => `Rating: ${n}/7`,
    noRating: 'No rating',
  },

  // KC#1058 — Sean Ellis product/market-fit score (survey pmf-sean-ellis).
  pmf: {
    sectionTitle: 'Product/market fit (Sean Ellis)',
    scoreCaption: 'answered "very disappointed"',
    marginOfError: (pct: string) => `±${pct} (95% confidence)`,
    benchmark: 'Target: 40% or more',
    aboveBenchmark: 'Above target',
    belowBenchmark: 'Below target',
    sample: (n: number, total: number) => `n = ${n} active respondents (of ${total} who answered)`,
    qualifiedHint: (days: number) =>
      `Only respondents who opened the app on at least ${days} days in the 14 days before answering count.`,
    smallSample: (min: number) => `Fewer than ${min} answers — the score is not stable yet.`,
    optionShare: (pct: string, count: number) => `${pct} · ${count}`,
    retention: (pct: string, retained: number, base: number) => `Back after a week: ${pct} (${retained}/${base})`,
    retentionPending: 'Back after a week: no data yet',
    retentionHint: 'Retention: answered 7+ days ago and opened the app again 7+ days after answering.',
    emptyTitle: 'No answers from active respondents yet.',
    errorTitle: 'Could not load the fit score.',
  },

  backToList: 'Back to survey list',
} as const;
