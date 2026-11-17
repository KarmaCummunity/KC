// Import a post from a message (FR-IMPORT-001, FR-IMPORT-007): the paste screen and its entry in
// the create form. The member confirms the post is their own before a draft is made (S90).
export const postImport = {
  entry: 'Import from a message',
  entryHint: 'Already posted this in a group? Paste it and we will make a draft.',
  screenTitle: 'Import from a message',
  intro: 'Paste a post you wrote in a group or on another site. We make a draft, and you check and fix it before it is published.',
  textLabel: 'The message',
  textPlaceholder: 'Paste the text of your post here',
  ownLabel: 'This is my post: I am the one giving or asking',
  ownHint: 'Only a post you wrote yourself can be imported. Someone else\'s post does not come into KC this way.',
  privacyNote: 'Phone numbers, e-mail addresses and links are removed from the text before it is processed.',
  submit: 'Make a draft',
  working: 'Making a draft',
  close: 'Close',
} as const;
