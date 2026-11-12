// app/apps/mobile/src/i18n/locales/he/modules/adminAdminsParity.ts
// The Hebrew staff-team bundle with the additions of the restored admin hierarchy: the
// last-administrator refusal in the revoke and grant/change errors, and the page-address card.
// Kept apart from `adminHierarchyParity.ts`, which must stay a leaf module: `adminPermissions`
// imports it, and `adminAdmins` imports `adminPermissions`, so importing `adminAdmins` there
// would close an import cycle (a temporal-dead-zone crash in the web bundle).
import { adminAdminsHe } from './adminAdmins';
import { orgLastAdminErrorHe, orgSlugHe } from './adminHierarchyParity';

export const adminAdminsParityHe = {
  ...adminAdminsHe,
  orgSlug: orgSlugHe,
  revokeErrors: { ...adminAdminsHe.revokeErrors, ...orgLastAdminErrorHe },
  grantModal: {
    ...adminAdminsHe.grantModal,
    errors: { ...adminAdminsHe.grantModal.errors, ...orgLastAdminErrorHe },
  },
};
