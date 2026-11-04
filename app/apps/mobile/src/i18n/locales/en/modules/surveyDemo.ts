// Survey UX-demo strings — internal preview, not loaded from the server.
// Mapped to: docs/SSOT/spec/11_settings.md "survey demo" entry.
export const surveyDemoEn = {
  entryTitle: 'Surveys (demo)',
  entryLabel: 'User-experience survey — sample preview',
  screenTitle: 'User-experience survey (demo)',
  progress: 'Question {{current}} of {{total}}',
  progressHint: 'Demo · not saved',
  questionIndex: 'Question {{index}}',
  ratingFieldLabel: 'Rating (1–7, required)',
  ratingLowHint: '1 = not enough',
  ratingHighHint: '7 = excellent',
  textFieldLabel: 'Details (optional)',
  questionMapTitle: 'All questions',
  navPrev: 'Previous',
  navNext: 'Next',
  navPrevA11y: 'Previous question',
  navNextA11y: 'Next question',
  ratingCellA11y: 'Rating {{value}}',
  questionA11y: 'Question {{index}}, {{label}}',
  questions: {
    q1: {
      shortLabel: 'Anonymity',
      prompt:
        'What do you think of the anonymity mechanism? Do you feel it meets your needs?',
      context:
        'We want to make sure you can ask for or give help without unnecessary exposure. Rate by how you truly feel — not by how it "should" be.',
      textPlaceholder:
        'For example: what helps you feel safe, and what still feels too exposed?',
    },
    q2: {
      shortLabel: 'Publishing posts',
      prompt: 'How easy and clear is it to publish a request or a give in the app?',
      context:
        'Think about the steps from idea to publishing: choosing a type, photo, location, and privacy settings. If you got stuck along the way — that\'s exactly what we want to hear.',
      textPlaceholder: 'Which step was the most confusing or the most lacking?',
    },
    q3: {
      shortLabel: 'Feed & search',
      prompt: 'How was the feed and search experience? Did you easily find what you were looking for?',
      context:
        'The feed is meant to connect people to relevant help. Search for something that interests you and consider whether the filtering, distance, and sorting helped you.',
      textPlaceholder: 'What did you search for and what was missing from the results?',
    },
    q4: {
      shortLabel: 'Notifications',
      prompt: 'Are the notifications relevant and not overwhelming? What would you change?',
      context:
        'Notifications should help in real time — not overwhelm. Consider critical notifications (closure, chat) versus social ones.',
      textPlaceholder: 'Which notifications would you remove or add?',
    },
    q5: {
      shortLabel: 'Overall recommendation',
      prompt: 'How likely are you to recommend Karma to a friend? What matters most to improve?',
      context:
        "This is a summary question: a high rating doesn't mean everything is perfect, and a low rating doesn't mean you didn't like it. Share in one word what would improve the experience most.",
      textPlaceholder: 'What is the first thing you would improve in Karma?',
    },
  },
} as const;
