// KC#869 — pure view helpers for the notification center: type icon + Today/Earlier grouping.
import type { Ionicons } from '@expo/vector-icons';

type IconName = keyof typeof Ionicons.glyphMap;

export function notificationIcon(kind: string): IconName {
  if (kind.endsWith('_message')) return 'chatbubble-ellipses-outline';
  if (kind.startsWith('ride_')) return 'car-outline';
  if (kind.startsWith('housing_')) return 'home-outline';
  if (kind.startsWith('event_')) return 'calendar-outline';
  if (kind === 'post_reaction') return 'heart-outline';
  if (kind === 'post_comment') return 'chatbox-outline';
  if (kind === 'post_mention') return 'at-outline';
  if (kind.startsWith('post_')) return 'gift-outline';
  if (kind.startsWith('follow_')) return 'person-add-outline';
  return 'notifications-outline';
}

export type InboxListItem<T> =
  | { type: 'header'; key: string; section: 'today' | 'earlier' }
  | { type: 'row'; key: string; item: T };

/** Splits newest-first rows into Today / Earlier sections (local day boundary). */
export function groupInboxByDay<T extends { id: string; createdAt: string }>(
  rows: readonly T[],
  now: Date = new Date(),
): InboxListItem<T>[] {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const today = rows.filter((r) => Date.parse(r.createdAt) >= startOfToday);
  const earlier = rows.filter((r) => Date.parse(r.createdAt) < startOfToday);
  const out: InboxListItem<T>[] = [];
  const push = (section: 'today' | 'earlier', list: readonly T[]) => {
    if (list.length === 0) return;
    out.push({ type: 'header', key: `h-${section}`, section });
    for (const item of list) out.push({ type: 'row', key: item.id, item });
  };
  push('today', today);
  push('earlier', earlier);
  return out;
}
