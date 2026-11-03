// app/apps/mobile/src/i18n/locales/he/modules/adminTeam.ts
// Hebrew strings for end-to-end team management on the person screen
// (FR-ADMIN-030): roles, role changes, permissions and the grant scope.

export const adminTeamHe = {
  addRole:            'הוספת תפקיד',
  changeRole:         'שינוי',
  platformScope:      'פלטפורמה',
  personFallback:     'משתמש',
  rolesNone:          'אין לאדם זה תפקידים פעילים.',
  manageFromSearch:   'תפקידים',
  permissions: {
    title:            'הרשאות',
    hint:             'ההרשאות נגזרות מהתפקיד. כדי לשנות הרשאות — משנים תפקיד.',
    none:             'תפקיד בארגון, ללא הרשאות ניהול בפורטל.',
    empty:            'אין הרשאות — לאדם זה אין תפקיד פעיל.',
  },
  scope: {
    label:            'היכן',
    none:             'אין לך הרשאה להעניק תפקידים.',
  },
  changeModal: {
    title:            'שינוי תפקיד',
    current:          (role: string, org: string) => `תפקיד נוכחי: ${role} · ${org}`,
    hint:             'האדם נשאר באותו מקום בהיררכיה: המנהל הישיר והכפופים עוברים לתפקיד החדש.',
    roleLabel:        'תפקיד חדש',
    noTargets:        'אין תפקיד אחר שאפשר להעביר אליו מתוך ההרשאות שלך.',
    cancel:           'ביטול',
    submit:           'שמירה',
  },
} as const;
