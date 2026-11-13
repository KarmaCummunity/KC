// Inline problems shown on the give / request form after a rejected Publish (FR-RESP-006 AC27).
export const createPostValidationEn = {
  missingTitle: 'Please fill in a title before publishing.',
  missingPhoto: 'Please add at least one photo before publishing.',
  linkUrlInvalid: 'Enter a link that starts with https://',
  linkNameShort: 'Enter a name of at least 2 characters',
  linkDescriptionTooLong: 'The description is too long',
} as const;
