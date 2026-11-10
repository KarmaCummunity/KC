// FR-NOTIF-018 (KC#1391) — every item / food handoff push has its copy where it is rendered:
// the dispatcher renders the push from its own `i18n.json` (Hebrew, server side), the app from
// its locales. Both must carry the same Hebrew text, and English must exist in the app.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NotificationKind } from '@kc/domain';
import he from '../locales/he';
import en from '../locales/en';

/** The handoff kinds 0528 enqueues; the copy key stem mirrors `giving_handoff_copy_key`. */
const HANDOFF_KINDS = [
  'giving_handoff_requested',
  'giving_handoff_claimed',
  'giving_handoff_confirmed',
  'giving_handoff_declined',
  'giving_handoff_cancelled',
  'giving_handoff_expired',
  'giving_handoff_completed',
] as const satisfies readonly NotificationKind[];

/** `giving_handoff_requested` → `givingHandoffRequested`, as the SQL helper derives it. */
function copyStem(kind: string): string {
  const [, , change] = kind.split('_');
  return `givingHandoff${change!.charAt(0).toUpperCase()}${change!.slice(1)}`;
}

const dispatcherCopy = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../../../supabase/functions/dispatch-notification/i18n.json'), 'utf8'),
) as Record<string, string>;

const notificationsCopy = (bundle: unknown) => (bundle as { notifications: Record<string, string> }).notifications;

describe('item / food handoff push copy', () => {
  it.each(HANDOFF_KINDS)('%s has the same Hebrew in the dispatcher and the app, and English', (kind) => {
    for (const part of ['Title', 'Body']) {
      const key = `${copyStem(kind)}${part}`;
      const serverHe = dispatcherCopy[`notifications.${key}`];
      expect(serverHe, `dispatcher notifications.${key}`).toBeTruthy();
      expect(notificationsCopy(he)[key]).toBe(serverHe);
      expect(notificationsCopy(en)[key]).toBeTruthy();
    }
  });
});

/** The knowledge booking kinds 0704 enqueues (#2034). */
const KNOWLEDGE_KINDS = [
  'knowledge_booking_requested',
  'knowledge_booking_confirmed',
  'knowledge_booking_declined',
  'knowledge_booking_expired',
  'knowledge_booking_cancelled',
  'knowledge_session_completed',
] as const satisfies readonly NotificationKind[];

/** `knowledge_booking_requested` → `knowledgeBookingRequested`, as `knowledge_booking_copy_key` derives it. */
function camelStem(kind: string): string {
  return kind.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

describe('knowledge booking push copy', () => {
  it.each(KNOWLEDGE_KINDS)('%s has the same Hebrew in the dispatcher and the app, and English', (kind) => {
    for (const part of ['Title', 'Body']) {
      const key = `${camelStem(kind)}${part}`;
      const serverHe = dispatcherCopy[`notifications.${key}`];
      expect(serverHe, `dispatcher notifications.${key}`).toBeTruthy();
      expect(notificationsCopy(he)[key]).toBe(serverHe);
      expect(notificationsCopy(en)[key]).toBeTruthy();
    }
  });
});
