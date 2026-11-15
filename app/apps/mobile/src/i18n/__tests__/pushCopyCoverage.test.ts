// Every push the server sends is rendered from the dispatcher's Hebrew strings
// (`strings.he.generated.json`, generated from the Hebrew locale by
// scripts/generate-notification-kinds.mjs); a key missing there reaches the phone as the raw key
// ("notifications.postCommentTitle"). This test reads each text key of the kind registry
// (`NOTIFICATION_KINDS`, generated from the baseline) and requires it in the dispatcher, the same
// Hebrew in the app, and English in the app.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NOTIFICATION_KINDS } from '@kc/domain';
import he from '../locales/he';
import en from '../locales/en';

const REPO = resolve(__dirname, '../../../../../..');

const dispatcherCopy = JSON.parse(
  readFileSync(resolve(REPO, 'supabase/functions/dispatch-notification/strings.he.generated.json'), 'utf8'),
) as Record<string, string>;

/** Every copy key a kind names (title, body, grouped body), without its `notifications.` prefix. */
function registryCopyKeys(): string[] {
  const keys = new Set<string>();
  for (const kind of Object.values(NOTIFICATION_KINDS)) {
    for (const key of [kind.titleKey, kind.bodyKey, kind.groupedBodyKey]) {
      if (key?.startsWith('notifications.')) keys.add(key.slice('notifications.'.length));
    }
  }
  return [...keys].sort();
}

const notificationsCopy = (bundle: unknown) => (bundle as { notifications: Record<string, string> }).notifications;

describe('push copy coverage', () => {
  const keys = registryCopyKeys();

  it('finds the registry keys', () => {
    expect(keys.length).toBeGreaterThan(50);
  });

  it.each(keys)('notifications.%s has dispatcher Hebrew, the same Hebrew in the app, and English', (key) => {
    const serverHe = dispatcherCopy[`notifications.${key}`];
    expect(serverHe, `dispatcher notifications.${key}`).toBeTruthy();
    expect(notificationsCopy(he)[key], `app he notifications.${key}`).toBe(serverHe);
    expect(notificationsCopy(en)[key], `app en notifications.${key}`).toBeTruthy();
  });
});
