// app/apps/mobile/src/i18n/locales/he/modules/adminPermissions.ts
// Hebrew labels for every admin-portal permission (FR-ADMIN-030, D85), shown on
// the person screen. Keyed by `AdminPermission`, so a new permission fails
// typecheck until it has a label.
import type { AdminPermission } from '@kc/domain';

export const adminPermissionsHe: Readonly<Record<AdminPermission, string>> = {
  'portal.access':              'כניסה לפורטל הניהול',
  'reports.view':               'צפייה בדיווחים',
  'reports.confirm_or_dismiss': 'אישור או דחייה של דיווחים',
  'reports.restore_target':     'שחזור תוכן שהוסר',
  'reports.permanent_ban':      'חסימת משתמשים לצמיתות',
  'reports.manual_remove_post': 'הסרת פוסטים',
  'reports.admin_edit_post':    'עריכת פוסטים',
  'chat.delete_message':        'מחיקת הודעות בצ׳אט',
  'tasks.view':                 'צפייה במשימות',
  'tasks.create':               'יצירת משימות',
  'tasks.delete_any':           'מחיקת כל משימה',
  'admins.view':                'צפייה בצוות הניהול',
  'admins.grant_role':          'הענקת תפקידים',
  'admins.revoke_role':         'ביטול תפקידים',
  'admins.set_manager':         'שיוך מנהל ישיר',
  'users.search':               'חיפוש משתמשים',
  'users.privacy_override':     'צפייה בפרופילים פרטיים',
  'posts.search':               'חיפוש פוסטים',
  'surveys.view':               'צפייה בתוצאות סקרים',
  'audit.view_own':             'צפייה ביומן הפעולות שלי',
  'audit.view_any':             'צפייה בכל יומן הפעולות',
  'time.report':                'דיווח שעות',
  'time.approve':               'אישור שעות',
  'money.manage':               'ניהול כספים',
  'crm.manage':                 'ניהול אנשי קשר',
  'org.review_applications':    'אישור בקשות ארגונים',
  'whatsapp.manage':            'ניהול וואטסאפ',
  'matching.view_quality':      'צפייה באיכות התאמות',
};
