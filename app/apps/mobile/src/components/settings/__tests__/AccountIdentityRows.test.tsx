// @vitest-environment jsdom
// The identity rows of Settings → Account (FR-SETTINGS-002 AC1, AC3; FR-SETTINGS-013): the
// read-only name, the masked email or phone (tap → "contact Support" dialog → Report Issue as
// Account), and the sign-in method, with the SSO note linking to the provider's account page.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  session: null as null | { email: string | null; phone?: string | null; signInProvider?: string | null },
  push: vi.fn(),
  openURL: vi.fn(),
}));

vi.mock('react-native-reanimated', async () => (await import('../../ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('expo-haptics', async () => (await import('../../ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('react-native-safe-area-context', async () => (await import('../../ui/__tests__/kitDialogTestKit')).safeAreaDouble);
vi.mock('react-i18next', async () => (await import('../../ui/__tests__/kitDialogTestKit')).i18nDouble);
vi.mock('@expo/vector-icons', async () => (await import('../../ui/__tests__/kitDialogTestKit')).iconsDouble);
// Reduced motion opens the dialog without the fade, which never finishes under jsdom.
vi.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('../../../store/authStore', () => ({
  useAuthStore: (selector: (state: { session: typeof mocks.session }) => unknown) => selector({ session: mocks.session }),
}));
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-native')>();
  return { ...actual, Linking: { ...actual.Linking, openURL: (url: string) => mocks.openURL(url) } };
});

import { renderInTheme } from '../../ui/__tests__/kitDialogTestKit';
import { AccountIdentityRows } from '../AccountIdentityRows';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.openURL.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('AccountIdentityRows', () => {
  it('shows the name and the masked email of an email member, without a provider link', () => {
    mocks.session = { email: 'dana.levi@example.com', signInProvider: 'email' };
    renderInTheme(<AccountIdentityRows displayName="Dana Levi" />);
    expect(screen.getByText('Dana Levi')).toBeTruthy();
    expect(screen.getByText('d•••i@example.com')).toBeTruthy();
    expect(screen.queryByText('dana.levi@example.com')).toBeNull();
    expect(screen.getByText('settings.accountIdentity.method.email')).toBeTruthy();
  });

  it('masks the phone of a phone member', () => {
    mocks.session = { email: null, phone: '972501234567', signInProvider: 'phone' };
    renderInTheme(<AccountIdentityRows displayName={null} />);
    expect(screen.getByText('settings.accountIdentity.noName')).toBeTruthy();
    expect(screen.getByText('•••••••••567')).toBeTruthy();
  });

  it('tells an SSO member the provider manages the sign-in, and links to its account page', () => {
    mocks.session = { email: 'dana@gmail.com', signInProvider: 'google' };
    renderInTheme(<AccountIdentityRows displayName="Dana" />);
    fireEvent.click(screen.getByText('settings.accountIdentity.method.google'));
    expect(mocks.openURL).toHaveBeenCalledWith('https://myaccount.google.com/');
  });

  it('opens the contact-change dialog from the contact row and sends the member to Report Issue as Account', () => {
    mocks.session = { email: 'dana@example.com', signInProvider: 'email' };
    renderInTheme(<AccountIdentityRows displayName="Dana" />);
    fireEvent.click(screen.getByText('d•••a@example.com'));
    expect(screen.getByRole('dialog', { name: 'settings.contactChange.title' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'settings.contactChange.cta' }));
    expect(mocks.push).toHaveBeenCalledWith({ pathname: '/settings/report-issue', params: { category: 'Account' } });
  });

  it('renders nothing while signed out', () => {
    mocks.session = null;
    renderInTheme(<AccountIdentityRows displayName={null} />);
    expect(screen.queryByText('settings.accountIdentity.noName')).toBeNull();
  });
});
