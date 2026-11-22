// English — knowledge trust copy (FR-KNOW-012, D40, D184, #2038): consulting-hour
// complete-profile gate, the "not binding advice" notice, and official shelf links.
export const knowledgeTrust = {
  create: {
    verifyTitle: 'Complete profile before a consulting hour',
    verifyBody:
      'A professional consulting hour needs a complete profile (name, city, photo, phone and more). Identity verification is not required.',
    verifyCta: 'Complete profile',
  },
  notice: {
    title: 'Not binding advice',
    body:
      "This is general information and a volunteer's opinion, not binding legal, financial or medical advice. For a binding answer contact an authorized body.",
  },
  consulting: {
    profession: 'Profession: {{profession}}',
    verification: "Giver's verification level",
  },
  shelfLinks: {
    title: 'Official bodies',
    openA11y: 'Open the website of {{name}}',
    linkError: 'We could not open that link. Try again later.',
  },
} as const;
