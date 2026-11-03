// app/apps/mobile/src/i18n/locales/en/modules/adminLayers.ts
// English strings for the layered hierarchy view of the admin team (FR-ADMIN-028).

/** "and N more roles", singular for one. */
function extraRolesEn(n: number): string {
  return n === 1 ? 'and 1 more role' : `and ${n} more roles`;
}

export const adminLayersEn = {
  apexTitle:   'Platform apex',
  levelTitle:  (n: number) => `Level ${n}`,
  empty:       'No role holders to show yet.',
  community: {
    title:      'Community',
    hint:       'Every community member without a role, including suspended users until an admin decides. Identities are masked — only the count is shown.',
    masked:     (n: number) => `${n} community members`,
    affiliated: (n: number) => `${n} affiliated volunteers (self-declared)`,
  },
  stats: {
    community:   'Community',
    roleHolders: 'Role holders',
    orgs:        'Organizations',
    affiliated:  'Affiliated volunteers',
  },
  showMore:    (n: number) => `+${n} more`,
  showLess:    'Show less',
  verified:    'Verified organization',
  moreRoles:   (n: number) => `+${n}`,
  loadError:   'Failed to load the hierarchy.',
  retry:       'Try again',
  personA11y:  (name: string, role: string, org: string, extraRoles: number) =>
    extraRoles > 0 ? `${name}, ${role} ${extraRolesEn(extraRoles)}, ${org}` : `${name}, ${role}, ${org}`,
  headcountA11y: (n: number) => `${n} people in this layer`,
} as const;
