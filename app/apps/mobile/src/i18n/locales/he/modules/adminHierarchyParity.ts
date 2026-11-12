// app/apps/mobile/src/i18n/locales/he/modules/adminHierarchyParity.ts
// Hebrew strings of the restored admin hierarchy (migrations 0011–0014): the staff roles the
// portal did not name yet, the last-administrator refusal, the finance permissions, the reason
// asked when a ledger entry is voided, and the super admin's change of an organization's page
// address. Mirrored key for key in `en/modules/adminHierarchyParity.ts`.
import { adminAdminsHe } from './adminAdmins';

/** Labels of the baseline roles added to the role vocabulary (FR-ADMIN-027 AC6, FR-FIN-002). */
export const adminRolesParityHe = {
  admin:          'אדמין',
  org_treasurer:  'גזבר בארגון',
  org_accountant: 'מנהל חשבונות בארגון',
  volunteer:      'מתנדב',
};

/** The refusal of a revoke or a role change that would leave an organization without an administrator. */
export const orgLastAdminErrorHe = {
  org_last_admin: 'זה המנהל האחרון של הארגון. קודם ממנים מנהל נוסף, ורק אז מבטלים או משנים.',
};

/** Labels of the finance permissions (FR-FIN-002). */
export const moneyPermissionsParityHe = {
  'money.view':         'צפייה בספרי הכספים',
  'money.transparency': 'הגדרות שקיפות ורשימת תורמים',
};

/** The reason asked before a ledger entry is voided (FR-FIN-005 AC2). */
export const moneyVoidHe = {
  title:             'ביטול רישום',
  hint:              'הרישום יישאר בספרים כמבוטל ולא ייספר בסכומים. כתבו למה הוא מבוטל.',
  reasonLabel:       'סיבת הביטול',
  reasonPlaceholder: 'לדוגמה: נרשם פעמיים',
  cancel:            'חזרה',
  confirm:           'ביטול הרישום',
};

/** Public finance switches: who changes them (kc_private.finance_assert 'transparency'). */
export const moneyVisibilityParityHe = {
  readOnly: 'רק מנהלי הפלטפורמה ומנהלי הארגון יכולים לשנות את ההגדרות האלה.',
};

/** The refusal of a void without a reason. */
export const moneyVoidErrorHe = {
  void_reason_required: 'צריך לכתוב סיבה באורך 3 עד 500 תווים.',
};

/** The super admin's change of an organization's page address (FR-ORG-001 AC5). */
export const orgSlugHe = {
  title:   'כתובת דף הארגון',
  current: (slug: string) => `הכתובת כרגע: ${slug}`,
  change:  'שינוי כתובת',
  label:   'כתובת חדשה',
  hint:    'אותיות לטיניות קטנות, ספרות ומקפים בין מילים.',
  save:    'שמירה',
  cancel:  'ביטול',
  errors: {
    invalid_slug:  'הכתובת יכולה לכלול רק אותיות לטיניות קטנות, ספרות ומקפים בין מילים.',
    slug_taken:    'הכתובת הזו כבר תפוסה.',
    org_not_found: 'הארגון לא נמצא.',
    forbidden:     'רק מנהל-העל יכול לשנות כתובת של דף ארגון.',
    unknown:       'משהו השתבש. אפשר לנסות שוב.',
  },
};

/**
 * The staff-team bundle with the additions above: the last-administrator refusal in the
 * revoke and grant/change errors, and the page-address card. Kept here so the existing
 * team module stays as it is.
 */
export const adminAdminsParityHe = {
  ...adminAdminsHe,
  orgSlug: orgSlugHe,
  revokeErrors: { ...adminAdminsHe.revokeErrors, ...orgLastAdminErrorHe },
  grantModal: {
    ...adminAdminsHe.grantModal,
    errors: { ...adminAdminsHe.grantModal.errors, ...orgLastAdminErrorHe },
  },
};
