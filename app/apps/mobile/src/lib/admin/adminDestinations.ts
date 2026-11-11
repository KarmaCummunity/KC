// app/apps/mobile/src/lib/admin/adminDestinations.ts
// FR-ADMIN-011 — the admin portal's destinations (screens), shared by the navigation rail and the
// dashboard search (#2081) so a screen added once shows up in both, with the same RBAC rule.
import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';
import type { Href } from 'expo-router';
import type { AdminPermission } from '@kc/domain';
import type { LocaleBundle } from '../../i18n/useLocaleBundle';

type IconName = ComponentProps<typeof Ionicons>['name'];

export interface AdminDestination {
  /** Key of the label in `admin.nav` (also the search result's identity). */
  readonly key: keyof LocaleBundle['admin']['nav'];
  readonly href: Extract<Href, string>;
  readonly icon: IconName;
  /** Permission needed to open it; `null` = every admin. */
  readonly perm: AdminPermission | null;
}

export const ADMIN_DESTINATIONS: readonly AdminDestination[] = [
  { key: 'dashboard', href: '/(admin)',         icon: 'grid-outline',             perm: null },
  { key: 'reports',   href: '/(admin)/reports', icon: 'flag-outline',             perm: null },
  { key: 'tasks',     href: '/(admin)/tasks',   icon: 'checkbox-outline',         perm: 'tasks.view' },
  { key: 'admins',    href: '/(admin)/admins',  icon: 'shield-checkmark-outline', perm: 'admins.view' },
  { key: 'users',     href: '/(admin)/users',   icon: 'people-outline',           perm: 'users.search' },
  { key: 'posts',     href: '/(admin)/posts',   icon: 'document-text-outline',    perm: 'posts.search' },
  { key: 'surveys',   href: '/(admin)/surveys', icon: 'bar-chart-outline',        perm: 'surveys.view' },
  { key: 'audit',     href: '/(admin)/audit',   icon: 'time-outline',             perm: 'audit.view_own' },
  { key: 'whatsapp',  href: '/(admin)/whatsapp', icon: 'logo-whatsapp',            perm: 'whatsapp.manage' },
  { key: 'matching',  href: '/(admin)/matching', icon: 'git-compare-outline',      perm: 'matching.view_quality' },
  { key: 'money',     href: '/(admin)/money',    icon: 'wallet-outline',           perm: 'money.manage' },
  { key: 'donationLinks', href: '/(admin)/donation-links', icon: 'link-outline',     perm: 'donation_links.review' },
  { key: 'stats',     href: '/(admin)/stats',    icon: 'stats-chart-outline',      perm: 'stats.view_platform' },
];

/**
 * Extra search words per destination, in Hebrew and English, for what an admin might type besides
 * the screen's title (a synonym, or the thing the screen manages). Lower-case; matched by substring.
 */
export const ADMIN_SEARCH_KEYWORDS: Readonly<Partial<Record<AdminDestination['key'], readonly string[]>>> = {
  dashboard: ['בית', 'ראשי', 'home', 'overview', 'main'],
  reports: ['דיווח', 'תלונה', 'הפרה', 'report', 'complaint', 'abuse', 'moderation', 'הסרה'],
  tasks: ['משימה', 'צוות', 'task', 'todo', 'ticket'],
  admins: ['מנהל', 'הרשאות', 'תפקיד', 'admin', 'permission', 'role', 'team'],
  users: ['משתמש', 'חבר', 'חשבון', 'חסימה', 'user', 'member', 'account', 'ban', 'block'],
  posts: ['פוסט', 'מודעה', 'תוכן', 'post', 'listing', 'content'],
  surveys: ['סקר', 'שאלון', 'survey', 'poll', 'questionnaire', 'research'],
  audit: ['יומן', 'לוג', 'היסטוריה', 'audit', 'log', 'history', 'activity'],
  whatsapp: ['וואטסאפ', 'ווטסאפ', 'בוט', 'whatsapp', 'bot', 'chat'],
  matching: ['התאמה', 'התאמות', 'match', 'quality', 'algorithm'],
  money: ['כסף', 'תשלום', 'תרומה', 'money', 'payment', 'finance', 'wallet'],
  donationLinks: ['תרומה', 'קישור', 'donate', 'link', 'url'],
  stats: ['סטטיסטיקה', 'נתונים', 'מדדים', 'stats', 'analytics', 'metrics', 'kpi', 'numbers'],
};
