// app/apps/mobile/src/components/auth/__tests__/welcomeEmailEntry.test.ts
//
// KC#1269 — FR-AUTH-001 AC2 + the FR-AUTH-002 MVP note (`docs/spec/requirements/01_auth_and_onboarding.md`):
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

// First-launch scope (2026-11-11): production hides every link to email auth, but the
// sign-in route itself stays reachable by direct link for the store-review demo account.
describe('email entry in a production first launch', () => {
  const read = (...p: string[]) => readFileSync(join(__dirname, '..', '..', '..', '..', 'app', ...p), 'utf8');

  it('shows the welcome entry only while the emailAuth surface is visible', () => {
    const source = read('(auth)', 'index.tsx');
    expect(source).toMatch(/useLaunchSurface\('emailAuth'\)/);
    expect(source).toMatch(/emailAuthVisible \? \(\s*<TouchableOpacity\s+testID="auth-email-entry"/);
  });

  it('keeps /sign-in itself ungated and hides its links to forgot-password and sign-up', () => {
    const source = read('(auth)', 'sign-in.tsx');
    expect(source).not.toMatch(/LaunchSurfaceGate/);
    expect(source).toMatch(/useLaunchSurface\('emailAuth'\)/);
    expect(source).toMatch(/emailFlowsLinked \? \(\s*<GhostButton\s+testID="auth-forgot-password"/);
    expect(source).toMatch(/emailFlowsLinked \? \(\s*<GhostButton\s+label=\{t\('auth\.noAccountSwitchCta'\)\}/);
  });

  it.each([
    ['(auth)/sign-up.tsx', ['(auth)', 'sign-up.tsx'], 'emailAuth'],
    ['(auth)/forgot-password.tsx', ['(auth)', 'forgot-password.tsx'], 'emailAuth'],
    ['auth/verify.tsx', ['auth', 'verify.tsx'], 'emailAuth'],
    ['auth/reset-password.tsx', ['auth', 'reset-password.tsx'], 'emailAuth'],
    ['settings/whatsapp.tsx', ['settings', 'whatsapp.tsx'], 'whatsappBot'],
    ['(admin)/whatsapp/index.tsx', ['(admin)', 'whatsapp', 'index.tsx'], 'whatsappBot'],
  ])('%s is wrapped in the launch-surface gate', (_name, path, surface) => {
    const source = read(...path);
    expect(source).toMatch(new RegExp(`<LaunchSurfaceGate surface="${surface}" redirectTo="[^"]+">`));
    expect(source).toMatch(/export default function \w+\(\) \{\s*return \(\s*<LaunchSurfaceGate/);
  });

  it('hides the WhatsApp settings row and the admin nav entry behind whatsappBot', () => {
    expect(read('settings.tsx')).toMatch(/whatsappBotVisible \? \(\s*<SettingsScreenRow\s+label=\{t\('settings\.whatsappRow'\)\}/);
    const nav = readFileSync(join(__dirname, '..', '..', 'admin', 'AdminNav.tsx'), 'utf8');
    expect(nav).toMatch(/it\.key !== 'whatsapp' \|\| whatsappBotVisible/);
  });
});
