// @vitest-environment jsdom
// FR-PROFILE-007 AC2: Edit Profile shows the sign-in identifiers (email / phone / provider)
// read-only, with a note that points to Support for a change.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  session: null as null | { email: string | null; phone?: string | null; signInProvider?: string | null },
  push: vi.fn(),
}));

vi.mock('react-native-reanimated', async () => (await import('../../ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('expo-haptics', async () => (await import('../../ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('react-native-safe-area-context', async () => (await import('../../ui/__tests__/kitDialogTestKit')).safeAreaDouble);
vi.mock('react-i18next', async () => (await import('../../ui/__tests__/kitDialogTestKit')).i18nDouble);
vi.mock('@expo/vector-icons', async () => (await import('../../ui/__tests__/kitDialogTestKit')).iconsDouble);
vi.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('../../../store/authStore', () => ({
  useAuthStore: (selector: (state: { session: typeof mocks.session }) => unknown) => selector({ session: mocks.session }),
}));

import { renderInTheme } from '../../ui/__tests__/kitDialogTestKit';
import { EditProfileSignInBlock } from '../EditProfileSignInBlock';

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('EditProfileSignInBlock', () => {
  it('shows the sign-in email and method in a field that cannot be edited', () => {
    mocks.session = { email: 'dana@example.com', signInProvider: 'google' };
    renderInTheme(<EditProfileSignInBlock />);
    const email = screen.getByLabelText('profile.editScreen.signIn.emailLabel') as HTMLInputElement;
    expect(email.value).toBe('dana@example.com');
    expect(email.readOnly || email.disabled).toBe(true);
    expect(screen.getByText('settings.accountIdentity.method.google')).toBeTruthy();
    expect(screen.queryByLabelText('profile.editScreen.signIn.phoneLabel')).toBeNull();
  });

  it('shows the sign-in phone of a phone member', () => {
    mocks.session = { email: null, phone: '972501234567', signInProvider: 'phone' };
    renderInTheme(<EditProfileSignInBlock />);
    expect((screen.getByLabelText('profile.editScreen.signIn.phoneLabel') as HTMLInputElement).value).toBe('972501234567');
  });

  it('points to Support for a change', () => {
    mocks.session = { email: 'dana@example.com', signInProvider: 'email' };
    renderInTheme(<EditProfileSignInBlock />);
    expect(screen.getByText('profile.editScreen.signIn.note')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'settings.contactChange.cta' }));
    expect(mocks.push).toHaveBeenCalledWith({ pathname: '/settings/report-issue', params: { category: 'Account' } });
  });

  it('renders nothing while signed out', () => {
    mocks.session = null;
    renderInTheme(<EditProfileSignInBlock />);
    expect(screen.queryByText('profile.editScreen.signIn.note')).toBeNull();
  });
});
