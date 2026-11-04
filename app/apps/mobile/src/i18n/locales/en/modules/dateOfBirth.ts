// FR-AUTH-010 AC2.d — private date of birth (18+).
export const dateOfBirthEn = {
  label: 'Date of birth',
  helper: 'Private and shown to no one. The minimum age is 18.',
  day: 'Day',
  month: 'Month',
  year: 'Year',
  errors: {
    underage: 'The community is for ages 18 and over.',
    invalid: 'The date of birth is not valid.',
  },
  gate: {
    title: 'One more detail before you continue',
    subtitle: 'A date of birth is needed to continue. It is stored privately.',
    save: 'Save and continue',
  },
} as const;
