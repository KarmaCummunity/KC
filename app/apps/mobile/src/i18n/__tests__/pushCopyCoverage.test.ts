// Every push the server enqueues is rendered from the dispatcher's own `i18n.json` (Hebrew); a key
// missing there reaches the phone as the raw key ("notifications.postCommentTitle"). This test
// reads each `'notifications.*'` copy key the migrations name and requires it in the dispatcher,
// the same Hebrew in the app, and English in the app.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import he from '../locales/he';
import en from '../locales/en';

const REPO = resolve(__dirname, '../../../../../..');
const MIGRATIONS = resolve(REPO, 'supabase/migrations');

const dispatcherCopy = JSON.parse(
  readFileSync(resolve(REPO, 'supabase/functions/dispatch-notification/i18n.json'), 'utf8'),
) as Record<string, string>;

/** Copy keys spelled out in full in any migration (a key built by concatenation is not found). */
function serverCopyKeys(): string[] {
  const keys = new Set<string>();
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql'))) {
    const sql = readFileSync(resolve(MIGRATIONS, file), 'utf8');
    for (const match of sql.matchAll(/'notifications\.([A-Za-z]+)'/g)) keys.add(match[1]!);
  }
  return [...keys].sort();
}

const notificationsCopy = (bundle: unknown) => (bundle as { notifications: Record<string, string> }).notifications;

describe('push copy coverage', () => {
  const keys = serverCopyKeys();

  it('finds the server keys', () => {
    expect(keys.length).toBeGreaterThan(50);
  });

  it.each(keys)('notifications.%s has dispatcher Hebrew, the same Hebrew in the app, and English', (key) => {
    const serverHe = dispatcherCopy[`notifications.${key}`];
    expect(serverHe, `dispatcher notifications.${key}`).toBeTruthy();
    expect(notificationsCopy(he)[key], `app he notifications.${key}`).toBe(serverHe);
    expect(notificationsCopy(en)[key], `app en notifications.${key}`).toBeTruthy();
  });
});
