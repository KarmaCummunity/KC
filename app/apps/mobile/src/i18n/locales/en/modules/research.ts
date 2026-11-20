// Public market research strings — FR-RESEARCH-001..003.
// Survey B (public web-only form) — web-only routes /research/[slug] and /research/thanks.
export const researchEn = {
  // Survey intro block (rendered above Q1, design spec §9)
  introHeading: 'Before you start — just two lines.',
  introLine1: "We're building an Israeli app for free giving, without the mess of the groups.",
  introLine2: '11 questions. Fully anonymous. A few minutes.',
  introLine3: 'Every answer here shapes how the app will actually look. Thank you.',

  // Progress
  progress: 'Question {{current}} of {{total}}',
  progressHint: 'You can navigate freely',
  questionIndex: 'Question {{index}}',

  // Fields
  ratingFieldLabel: 'Rating (1–7, required)',
  textFieldLabel: 'Details (optional)',

  // Q11 contact section (last question — "שיחה איתנו")
  contactSectionTitle: 'Contact details (optional)',
  contactEmailLabel: 'Email for contact',
  contactEmailPlaceholder: 'your@email.com',
  contactWindowLabel: 'Convenient time to talk',
  contactWindowPlaceholder: 'For example: Sun–Thu after 6:00 PM',

  // Floating nav on last question
  navFinish: 'Finish',

  // Submit
  submitBtn: 'Submit answers',
  submitting: 'Sending...',
  submitRequiresAllRatings: 'Please rate all questions before finishing — check the flagged questions',

  // Loading
  loading: 'Loading survey...',

  // Error states (mapped from PublicResearchErrorCode)
  errorRateLimited: "You've already tried today, we'll try again in a minute",
  errorCircuitOpen: 'The server is busy right now, try again in a few minutes',
  errorSurveyNotFound: 'This survey is not active',
  errorInvalidEmail: 'The email address is invalid — fix it or leave it blank',
  errorInvalidSource: 'The survey link is invalid — try again from the original link',
  errorGeneric: 'Something went wrong, please try again',
  retryBtn: 'Try again',

  // Thank-you page (design spec §9)
  thanksHeading: 'Thank you. Truly.',
  thanksLine1: "We read every word — and it's shaping what we're building right now.",
  thanksLine2: 'The most helpful thing now is to pass the survey on to people who haven\'t heard of Karma yet.',
  thanksSignUpLead:
    'Want to get notifications, post, and receive when the app is ready? Join now — the survey stays anonymous.',
  thanksEmailOptInLabel: 'Want to be among the first to see the app when it launches?',
  thanksEmailPlaceholder: 'Leave your email',
  thanksVisitCta: 'Visit the Karma website',

  thankYouModal: {
    title: 'Thanks for taking the survey!',
    message:
      'One moment — know someone this is relevant to? ' +
      'If anyone around you gives or receives in groups — sharing the link helps us hear more voices.',
    dismiss: 'Close',
  },

  guestInvite: {
    kicker: 'No sign-up needed — you can continue',
    title: 'Karma Community market research — open to everyone',
    body:
      'You can fill out the survey without an account. If you want to get notifications, post, and receive — join the app whenever it suits you.',
    signUpCta: 'Join Karma',
    finePrint: 'The survey stays anonymous even after sign-up.',
  },

  // FR-RESEARCH-004 — share affordance copy for public surfaces (placements 1 + 2)
  share: {
    // Placement 1 — thank-you page primary CTA
    thanksTitle: 'Share the survey with a friend',
    thanksHelp: 'Help your voice reach others who aren\'t on the app yet',
    thanksBlockTitle: 'Someone else who needs to hear this?',
    thanksBlockBody:
      'Send the link to a friend, a group, or anyone still giving on Facebook and WhatsApp — every extra answer strengthens what we\'re building.',

    // End-of-survey card (before submit)
    endSurveyEyebrow: 'Before you submit',
    endSurveyTitle: 'One moment — know someone this is relevant to?',
    endSurveyBody:
      'If anyone around you gives or receives in groups — sharing the link takes a second and helps us hear more voices.',
    endSurveyCta: 'Share the survey now',
    endSurveyMessage:
      'I just filled out a short Karma survey about free giving in Israel — anonymous, no sign-up. I\'d love it if you answered too:',

    // Placement 2 — small button in survey form header
    duringSurveyLabel: 'Share',
    duringSurveyAria: 'Share the survey with a friend',

    // Web-platform OS share-sheet title
    shareTitle: 'Karma Community market research',

    // Body of the share message — identical to in-app variant
    shareMessage:
      "We're building an Israeli app for free giving, without the mess of the groups. " +
      'A short anonymous questionnaire, no sign-up — your answers shape how it will actually look.',

    // Status feedback (inline status line per AC8)
    statusShared: 'Link shared',
    statusCopied: 'Link copied',
    statusFailed: "Couldn't share, please try again",
  },
} as const;
