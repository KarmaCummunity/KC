// §5.11 (#1476) — English strings for the /admin/org-jobs screen: which organizations may publish
// job offers, switched by platform admins.
export const adminOrgJobsEn = {
  title: 'Organizations posting jobs',
  hint: 'A job offer is published only for an organization allowed here, once you checked it may employ people. Karma Community always may. Stopping an organization does not close job offers already published.',
  readOnly: 'Only platform admins can change this.',
  loading: 'Loading...',
  loadError: 'We could not load the organizations.',
  empty: 'No organizations yet.',
  allowed: 'May post jobs',
  notAllowed: 'May not post jobs',
  platform: 'KC\'s own organization: always allowed',
  suspended: 'Suspended: does not post',
  allow: 'Allow',
  stop: 'Stop',
  saveError: 'We could not update the organization. Please try again.',
} as const;
