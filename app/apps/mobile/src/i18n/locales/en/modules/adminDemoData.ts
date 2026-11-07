// FR-ADMIN-031 — admin demo-data screen (remove the kc-dev fake seed from the portal).
export const adminDemoDataEn = {
  title: 'Demo data',
  subtitle: 'Fake users and content of the dev environment, so you can test on real data only.',
  forbiddenTitle: 'Only the super admin or the Karma Community org admin can manage demo data.',
  loading: 'Loading...',
  error: 'Could not load the status. Pull to refresh.',
  users: 'Demo users',
  organizations: 'Demo nonprofits',
  noneTitle: 'No demo data in the system',
  noneHintRestore: 'You can bring it back with one press.',
  noneHintNoRestore: 'Restoring is available in the dev environment only.',
  seedButton: 'Restore demo data',
  seedWhileDemoExistsHint: 'Rebuilds all demo data from scratch (wipes existing demo rows first, same as delete then restore).',
  seeding: 'Restoring...',
  seedProgress: (step: string) =>
    ({
      wipe: 'Restore: clearing old demo…',
      users: 'Restore: creating users…',
      items: 'Restore: posts and rides…',
      worlds: 'Restore: giving worlds…',
      social: 'Restore: follows and chats…',
      matches: 'Restore: matches…',
      orgs: 'Restore: demo nonprofits…',
      done: 'Restore: finishing…',
    })[step] ?? 'Restoring…',
  passwordLabel: 'Password for the demo users',
  passwordHint: 'Needed once, at least 8 characters. It is stored hashed.',
  seedDoneTitle: 'Demo data restored',
  seedDone: (users: number, posts: number, orgs: number) => `Created ${users} users, ${posts} posts and ${orgs} nonprofits.`,
  seedFailed: 'Restoring failed. Try again.',
  wipeButton: 'Delete all demo data',
  wiping: 'Deleting...',
  wipeProgress: (step: string) =>
    ({ content: 'Delete: demo content…', accounts: 'Delete: users and nonprofits…', done: 'Delete: finishing…' })[
      step
    ] ?? 'Deleting…',
  confirmTitle: 'Delete all demo data?',
  confirmBody: (users: number, orgs: number) =>
    `This deletes ${users} demo users with all their content (posts, rides, chats, follows) and ${orgs} demo nonprofits. Real users are not affected. It cannot be undone from the portal.`,
  confirmOk: 'Delete',
  confirmCancel: 'Cancel',
  doneTitle: 'Demo data deleted',
  done: (users: number, orgs: number) => `Deleted ${users} users and ${orgs} nonprofits.`,
  orgsKept: (n: number) => `${n} demo nonprofits were kept because they have payment history.`,
  wipeFailed: 'Deleting failed. Try again.',
  errors: {
    generic: 'The operation failed. Try again or pull to refresh.',
    forbidden: 'Not allowed. Only the super admin or the Karma Community org admin can manage demo data (not other org admins).',
    publisherRefs:
      'Demo wipe was blocked because a demo user is recorded as the publisher of legal document versions. Migration 0653 reassigns this automatically on deploy.',
    cannotWipeSelf: 'You cannot wipe demo data while signed in as a demo user (@seed.kc.test). Sign out and use a real admin account.',
    notDevEnvironment: 'Demo restore is only available on the kc-dev database.',
    passwordRequired: 'A password of at least 8 characters is required for demo users (first time).',
    passwordTooShort: 'Password is too short — at least 8 characters.',
    timeout: 'One step took too long. Try again; contact the team if it keeps failing.',
    operationBusy: 'Another demo operation is in progress. Wait or refresh this screen.',
  },
};
