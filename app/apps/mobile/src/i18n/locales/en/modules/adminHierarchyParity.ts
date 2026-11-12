// app/apps/mobile/src/i18n/locales/en/modules/adminHierarchyParity.ts
// English strings of the restored admin hierarchy (migrations 0011–0014): the staff roles the
// portal did not name yet, the last-administrator refusal, the finance permissions, the reason
// asked when a ledger entry is voided, and the super admin's change of an organization's page
// address. Mirrors `he/modules/adminHierarchyParity.ts` key for key.

/** Labels of the baseline roles added to the role vocabulary (FR-ADMIN-027 AC6, FR-FIN-002). */
export const adminRolesParityEn = {
  admin:          'Admin',
  org_treasurer:  'Organization treasurer',
  org_accountant: 'Organization accountant',
  volunteer:      'Volunteer',
};

/** The refusal of a revoke or a role change that would leave an organization without an administrator. */
export const orgLastAdminErrorEn = {
  org_last_admin: 'This is the organization\'s last administrator. Appoint another administrator first.',
};

/** Labels of the finance permissions (FR-FIN-002). */
export const moneyPermissionsParityEn = {
  'money.view':         'View the books',
  'money.transparency': 'Transparency settings and donors',
};

/** The reason asked before a ledger entry is voided (FR-FIN-005 AC2). */
export const moneyVoidEn = {
  title:             'Void entry',
  hint:              'The entry stays in the books as voided and counts in no total. Say why it is voided.',
  reasonLabel:       'Reason',
  reasonPlaceholder: 'For example: entered twice',
  cancel:            'Back',
  confirm:           'Void entry',
};

/** Public finance switches: who changes them (kc_private.finance_assert 'transparency'). */
export const moneyVisibilityParityEn = {
  readOnly: 'Only platform admins and organization administrators can change these settings.',
};

/** The refusal of a void without a reason. */
export const moneyVoidErrorEn = {
  void_reason_required: 'Write a reason of 3 to 500 characters.',
};

/** The super admin's change of an organization's page address (FR-ORG-001 AC5). */
export const orgSlugEn = {
  title:   'Organization page address',
  current: (slug: string) => `Current address: ${slug}`,
  change:  'Change address',
  label:   'New address',
  hint:    'Lowercase Latin letters, digits and hyphens between words.',
  save:    'Save',
  cancel:  'Cancel',
  errors: {
    invalid_slug:  'Use lowercase Latin letters, digits and hyphens between words only.',
    slug_taken:    'This address is already taken.',
    org_not_found: 'The organization was not found.',
    forbidden:     'Only the super admin can change an organization page address.',
    unknown:       'Something went wrong. Try again.',
  },
};
