import type { AdminRole } from './AdminRole';

export const ADMIN_PERMISSIONS = [
  'portal.access',
  'reports.view',
  'reports.confirm_or_dismiss',
  'reports.restore_target',
  'reports.permanent_ban',
  'reports.manual_remove_post',
  'reports.admin_edit_post',
  'chat.delete_message',
  'tasks.view',
  'tasks.create',
  'tasks.delete_any',
  'admins.view',
  'admins.grant_role',
  'admins.revoke_role',
  'admins.set_manager',
  'users.search',
  'users.privacy_override',
  'posts.search',
  'surveys.view',
  'audit.view_own',
  'audit.view_any',
  'time.report',
  'time.approve',
  'money.view',
  'money.manage',
  'money.transparency',
  'crm.manage',
  'org.review_applications',
  'whatsapp.manage',
  'whatsapp.configure',
  'matching.view_quality',
  'donation_links.review',
  'stats.view_platform',
  'worlds.launch',
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

/**
 * Org roles that run their own org's team in the portal (project book D86):
 * they see the team area and may grant, change and revoke roles. The server
 * scopes every call to their org (`admin_granting_grant`, `admin_list_admins`).
 */
const ORG_TEAM_MANAGERS: readonly AdminRole[] = [
  'org_admin', 'org_manager', 'volunteer_manager', 'operators_manager',
];

/**
 * Platform staff from the given role up. The server checks platform roles by rank
 * (`kc_access.has_admin_role`), so a platform `admin` passes every check a moderator or a
 * support member passes.
 */
const SUPPORT_UP: readonly AdminRole[] = ['super_admin', 'admin', 'moderator', 'support'];
const MODERATOR_UP: readonly AdminRole[] = ['super_admin', 'admin', 'moderator'];
const ADMIN_UP: readonly AdminRole[] = ['super_admin', 'admin'];

/**
 * Permissions are role-derived only (project book D85): a person's
 * permissions are the union of their roles' rows here, never set per person.
 */
export const PERMISSION_MATRIX: Readonly<Record<AdminPermission, readonly AdminRole[]>> = {
  'portal.access':              SUPPORT_UP,
  'reports.view':               SUPPORT_UP,
  'reports.confirm_or_dismiss': MODERATOR_UP,
  'reports.restore_target':     MODERATOR_UP,
  'reports.permanent_ban':      ['super_admin'],
  'reports.manual_remove_post': MODERATOR_UP,
  'reports.admin_edit_post':    ['super_admin', 'moderator'],
  'chat.delete_message':        MODERATOR_UP,
  'tasks.view':                 SUPPORT_UP,
  'tasks.create':               SUPPORT_UP,
  'tasks.delete_any':           ['super_admin'],
  'admins.view':                [...MODERATOR_UP, ...ORG_TEAM_MANAGERS],
  // Gates for the team-management UI; which roles and orgs are actually
  // offered comes from GrantAuthority, and the RPCs re-check scoped authority.
  'admins.grant_role':          [...ADMIN_UP, ...ORG_TEAM_MANAGERS],
  'admins.revoke_role':         [...ADMIN_UP, ...ORG_TEAM_MANAGERS],
  'admins.set_manager':         [...ADMIN_UP, ...ORG_TEAM_MANAGERS],
  'users.search':               SUPPORT_UP,
  'users.privacy_override':     SUPPORT_UP,
  'posts.search':               SUPPORT_UP,
  'surveys.view':               MODERATOR_UP,
  'audit.view_own':             SUPPORT_UP,
  'audit.view_any':             ['super_admin'],
  'time.report':                SUPPORT_UP,
  'time.approve':               MODERATOR_UP,
  // FR-FIN-002 (kc_private.finance_assert): moderators read the platform books only; the
  // books are kept by platform admins, org admins and treasurers; accountants read them.
  'money.view':                 [...MODERATOR_UP, 'org_admin', 'org_treasurer', 'org_accountant'],
  'money.manage':               [...ADMIN_UP, 'org_admin', 'org_treasurer'],
  // Public finance switches and the donors overview: platform admins and org admins.
  'money.transparency':         [...ADMIN_UP, 'org_admin'],
  // FR-ADMIN-032 — an organization's managers run its contact book; platform staff run the
  // platform organization's (the server scopes every call, kc_private.crm_assert).
  'crm.manage':                 [...MODERATOR_UP, 'org_admin', 'org_manager'],
  // 20_organizations `org.review_applications`: the server opens the queue to admins and up.
  'org.review_applications':    ADMIN_UP,
  'whatsapp.manage':            MODERATOR_UP,
  // The WhatsApp send limits and template approval (api_whatsapp_admin_set_send_limits /
  // _set_template_status) are super admin only on the server.
  'whatsapp.configure':         ['super_admin'],
  // KC#1122 / FR-ADMIN-029 — the server opens admin_match_quality to moderators and above.
  'matching.view_quality':      MODERATOR_UP,
  // D9 — approve or reject suggested donation links (server: moderators and above).
  'donation_links.review':      MODERATOR_UP,
  // FR-STATS-007 — platform statistics (flow funnel); moderators and above.
  'stats.view_platform':        MODERATOR_UP,
  // #2277: only the super admin switches a giving world between portal and active.
  'worlds.launch':              ['super_admin'],
};

export function hasPermission(
  roles: readonly AdminRole[],
  permission: AdminPermission,
): boolean {
  const allowed = PERMISSION_MATRIX[permission];
  for (const r of roles) {
    if (allowed.includes(r)) return true;
  }
  return false;
}

/** Every permission `role` carries, in matrix order (D85 — role-derived only). */
export function permissionsOfRole(role: AdminRole): AdminPermission[] {
  return ADMIN_PERMISSIONS.filter((permission) => PERMISSION_MATRIX[permission].includes(role));
}
