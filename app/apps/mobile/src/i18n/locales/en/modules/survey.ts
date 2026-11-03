// Production survey strings — FR-SETTINGS-015..017.
// Kept separate from surveyDemo.ts (design-QA preview) per §8 naming convention.
export const surveyEn = {
  // Settings root entry row (FR-SETTINGS-015)
  entryTitle: 'Surveys & feedback',

  // Hub (FR-SETTINGS-015)
  hubTitle: 'Surveys & feedback',
  hubSectionTitle: 'Surveys & feedback',
  freeFeedbackRow: 'Open feedback',
  emptyState: 'No active surveys right now.',

  // Status chips (FR-SETTINGS-015 AC2)
  statusNotStarted: 'Not started',
  statusInProgress: 'In progress',
  statusCompleted: 'Completed',

  // Survey runner (FR-SETTINGS-016)
  progress: 'Question {{current}} of {{total}}',
  progressHint: 'You can go back and edit',
  questionIndex: 'Question {{index}}',
  ratingFieldLabel: 'Rating (1–7, required)',
  choiceFieldLabel: 'Choose one (required)',
  textFieldLabel: 'Details (optional)',
  savingLabel: 'Saving...',
  saveErrorTitle: 'Save error',
  saveErrorMessage: 'Could not save your answers. Please try again.',
  loadErrorTitle: 'Loading error',
  loadErrorMessage: 'Could not load the survey. Please try again.',

  thankYouModal: {
    title: 'Thanks for taking the survey',
    message: 'Your answers were saved. Your feedback helps us improve the community — you can go back and edit anytime.',
    dismiss: 'Great',
  },

  // Free feedback (FR-SETTINGS-017)
  feedbackRatingLow: 'Not enough',
  feedbackRatingHigh: 'Excellent',
  feedbackTitle: 'Open feedback',
  feedbackBodyLabel: 'What would you like to share? (required)',
  feedbackBodyPlaceholder: 'Share thoughts, suggestions, or any feedback... (at least 10 characters)',
  feedbackRatingLabel: 'Overall rating (optional)',
  feedbackSubmitBtn: 'Submit feedback',
  feedbackSubmitting: 'Sending...',
  feedbackSuccessToast: 'Feedback sent. Thank you!',
  feedbackErrorTitle: 'Error',
  feedbackErrorBodyTooShort: 'The text must contain at least 10 characters.',
  feedbackErrorBodyTooLong: 'The text cannot exceed 500 characters.',
  feedbackErrorGeneric: 'Submission failed. Please try again.',

  // Prompt banner (FR-SETTINGS-016 AC6)
  bannerTitle: 'We have a question for you',
  bannerBody: 'Help us improve the community — just a few minutes.',
  bannerCta: 'Take survey',
  bannerSnooze: 'Later',

  // FR-RESEARCH-004 — in-app Settings → Surveys row (placement 3)
  shareResearch: {
    rowTitle: 'Share the market research with friends',
    rowSubtitle: 'Help us understand what people not on the app need — anonymous, no sign-up',
    cardShareA11y: 'Share the market research',
    shareTitle: 'Karma Community market research',
    shareMessage:
      "We're building an Israeli app for free giving, without the mess of the groups. " +
      'A short anonymous questionnaire, no sign-up — your answers shape how it will actually look.',
    toastShared: 'Link shared',
    toastCopied: 'Link copied',
    toastFailed: "Couldn't share, please try again",
  },
} as const;
