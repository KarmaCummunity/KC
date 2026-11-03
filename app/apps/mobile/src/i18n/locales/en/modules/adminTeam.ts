// app/apps/mobile/src/i18n/locales/en/modules/adminTeam.ts
// English strings for end-to-end team management on the person screen
// (FR-ADMIN-030): roles, role changes, permissions and the grant scope.

export const adminTeamEn = {
  addRole:            'Add role',
  changeRole:         'Change',
  platformScope:      'Platform',
  personFallback:     'User',
  rolesNone:          'This person holds no active role.',
  manageFromSearch:   'Roles',
  permissions: {
    title:            'Permissions',
    hint:             'Permissions come from the role. To change permissions, change the role.',
    none:             'An organization role with no admin-portal permissions.',
    empty:            'No permissions — this person holds no active role.',
  },
  scope: {
    label:            'Where',
    none:             'You are not allowed to grant roles.',
  },
  changeModal: {
    title:            'Change role',
    current:          (role: string, org: string) => `Current role: ${role} · ${org}`,
    hint:             'The person keeps their place in the hierarchy: their manager and reports move to the new role.',
    roleLabel:        'New role',
    noTargets:        'There is no other role you may move this person to.',
    cancel:           'Cancel',
    submit:           'Save',
  },
} as const;
