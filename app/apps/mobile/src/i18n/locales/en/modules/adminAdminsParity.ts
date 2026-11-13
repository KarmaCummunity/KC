// app/apps/mobile/src/i18n/locales/en/modules/adminAdminsParity.ts
// The English staff-team bundle with the additions of the restored admin hierarchy: the
// last-administrator refusal in the revoke and grant/change errors, and the page-address card.
// Kept apart from `adminHierarchyParity.ts`, which must stay a leaf module: `adminPermissions`
// imports it, and `adminAdmins` imports `adminPermissions`, so importing `adminAdmins` there
// would close an import cycle (a temporal-dead-zone crash in the web bundle).
import { adminAdminsEn } from './adminAdmins';
import { orgLastAdminErrorEn, orgSlugEn } from './adminHierarchyParity';

export const adminAdminsParityEn = {
  ...adminAdminsEn,
  orgSlug: orgSlugEn,
  revokeErrors: { ...adminAdminsEn.revokeErrors, ...orgLastAdminErrorEn },
  grantModal: {
    ...adminAdminsEn.grantModal,
    errors: { ...adminAdminsEn.grantModal.errors, ...orgLastAdminErrorEn },
  },
};
