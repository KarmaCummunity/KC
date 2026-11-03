// FR-ADMIN-031 — admin demo-data screen (remove the kc-dev fake seed from the portal).
export const adminDemoDataEn = {
  title: 'Demo data',
  subtitle: 'Fake users and content of the dev environment, so you can test on real data only.',
  forbiddenTitle: 'Only a super admin can manage demo data.',
  loading: 'Loading...',
  error: 'Could not load the status. Pull to refresh.',
  users: 'Demo users',
  organizations: 'Demo nonprofits',
  noneTitle: 'No demo data in the system',
  noneHint: 'To bring it back, run the "Seed KC dev" action in GitHub Actions.',
  restoreNote: 'To restore the demo data: GitHub Actions → Seed KC dev → seed.',
  wipeButton: 'Delete all demo data',
  wiping: 'Deleting...',
  confirmTitle: 'Delete all demo data?',
  confirmBody: (users: number, orgs: number) =>
    `This deletes ${users} demo users with all their content (posts, rides, chats, follows) and ${orgs} demo nonprofits. Real users are not affected. It cannot be undone from the portal.`,
  confirmOk: 'Delete',
  confirmCancel: 'Cancel',
  doneTitle: 'Demo data deleted',
  done: (users: number, orgs: number) => `Deleted ${users} users and ${orgs} nonprofits.`,
  orgsKept: (n: number) => `${n} demo nonprofits were kept because they have payment history.`,
  wipeFailed: 'Deleting failed. Try again.',
};
