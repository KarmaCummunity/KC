// app/apps/mobile/src/i18n/locales/en/modules/adminPermissions.ts
// English labels for every admin-portal permission (FR-ADMIN-030, D85), shown
// on the person screen. Keyed by `AdminPermission`, so a new permission fails
// typecheck until it has a label.
import type { AdminPermission } from '@kc/domain';

export const adminPermissionsEn: Readonly<Record<AdminPermission, string>> = {
  'portal.access':              'Enter the admin portal',
  'reports.view':               'View reports',
  'reports.confirm_or_dismiss': 'Confirm or dismiss reports',
  'reports.restore_target':     'Restore removed content',
  'reports.permanent_ban':      'Ban users permanently',
  'reports.manual_remove_post': 'Remove posts',
  'reports.admin_edit_post':    'Edit posts',
  'chat.delete_message':        'Delete chat messages',
  'tasks.view':                 'View tasks',
  'tasks.create':               'Create tasks',
  'tasks.delete_any':           'Delete any task',
  'admins.view':                'View the admin team',
  'admins.grant_role':          'Grant roles',
  'admins.revoke_role':         'Revoke roles',
  'admins.set_manager':         'Assign direct managers',
  'users.search':               'Search users',
  'users.privacy_override':     'View private profiles',
  'posts.search':               'Search posts',
  'surveys.view':               'View survey results',
  'audit.view_own':             'View my audit log',
  'audit.view_any':             'View the full audit log',
  'time.report':                'Report hours',
  'time.approve':               'Approve hours',
  'money.manage':               'Manage money',
  'crm.manage':                 'Manage contacts',
  'org.review_applications':    'Review organization applications',
  'whatsapp.manage':            'Manage WhatsApp',
  'matching.view_quality':      'View match quality',
};
