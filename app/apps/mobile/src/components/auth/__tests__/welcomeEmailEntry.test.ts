// app/apps/mobile/src/components/auth/__tests__/welcomeEmailEntry.test.ts
//
// KC#1269 — FR-AUTH-001 AC2 + the FR-AUTH-002 MVP note (`docs/SSOT/spec/01_auth_and_onboarding.md`):
// the welcome screen keeps a text link to email/password sign-in on every platform. Without it
// a native build has no route to `/(auth)/sign-in`, so store reviewers and seed / E2E users
// cannot log in.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const WELCOME_SCREEN = join(__dirname, '..', '..', '..', '..', 'app', '(auth)', 'index.tsx');

describe('welcome screen email entry', () => {
  const source = readFileSync(WELCOME_SCREEN, 'utf8');

  it('links to the email sign-in screen with a stable test id', () => {
    expect(source).toMatch(/testID="auth-email-entry"/);
    expect(source).toMatch(/router\.push\('\/\(auth\)\/sign-in'\)/);
    expect(source).toMatch(/t\('auth\.continueWithEmail'\)/);
  });

  it('does not gate the email entry behind a platform check', () => {
    const at = source.indexOf('testID="auth-email-entry"');
    expect(at).toBeGreaterThan(0);
    // The element opening sits just before its testID; no `Platform.OS` guard may wrap it.
    const entry = source.slice(Math.max(0, at - 400), at);
    expect(entry).not.toMatch(/Platform\.OS/);
  });
});
