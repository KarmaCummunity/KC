// app/apps/mobile/src/i18n/locales/he/modules/adminLayers.ts
// Hebrew strings for the layered hierarchy view of the admin team (FR-ADMIN-028).

/** "and N more roles" — Hebrew pairs the number one with the singular noun. */
function extraRolesHe(n: number): string {
  return n === 1 ? 'ועוד תפקיד אחד' : `ועוד ${n} תפקידים`;
}

export const adminLayersHe = {
  apexTitle:   'צמרת הפלטפורמה',
  levelTitle:  (n: number) => `רמה ${n}`,
  empty:       'עדיין אין בעלי תפקידים להצגה.',
  community: {
    title:      'הקהילה',
    hint:       'כל חברי הקהילה ללא תפקיד, כולל משתמשים מושהים עד החלטת מנהל. הזהויות מוסתרות — מוצגת ספירה בלבד.',
    masked:     (n: number) => `${n} חברי קהילה`,
    affiliated: (n: number) => `${n} מתנדבים משויכים (בהצהרה עצמית)`,
  },
  stats: {
    community:   'חברי קהילה',
    roleHolders: 'בעלי תפקידים',
    orgs:        'ארגונים',
    affiliated:  'מתנדבים משויכים',
  },
  showMore:    (n: number) => `+${n} נוספים`,
  showLess:    'הצג פחות',
  verified:    'ארגון מאומת',
  moreRoles:   (n: number) => `+${n}`,
  loadError:   'טעינת מבנה ההיררכיה נכשלה.',
  retry:       'נסה שוב',
  personA11y:  (name: string, role: string, org: string, extraRoles: number) =>
    extraRoles > 0 ? `${name}, ${role} ${extraRolesHe(extraRoles)}, ${org}` : `${name}, ${role}, ${org}`,
  headcountA11y: (n: number) => `${n} אנשים בשכבה`,
} as const;
