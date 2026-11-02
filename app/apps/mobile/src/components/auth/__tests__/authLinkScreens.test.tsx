// @vitest-environment jsdom
// Auth link routes on the kit buttons (FR-AUTH-003 / 006 / 008, spec 17 §4.1.1, TD-243):
// forgot / reset password submit through a busy primary button, and every
// status state offers its one way forward.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent } from '@testing-library/react';

const router = { back: vi.fn(), push: vi.fn(), replace: vi.fn() };
let params: Record<string, string> = {};
const requestReset = vi.fn();
const verifyEmail = vi.fn();

vi.mock('react-native-reanimated', async () => (await import('../../ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('expo-haptics', async () => (await import('../../ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('@expo/vector-icons', async () => (await import('../../ui/__tests__/kitDialogTestKit')).iconsDouble);
vi.mock('react-i18next', async () => (await import('../../ui/__tests__/kitDialogTestKit')).i18nDouble);
vi.mock('react-native-safe-area-context', async () => (await import('../../ui/__tests__/kitDialogTestKit')).safeAreaDouble);
vi.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('expo-router', () => ({ useRouter: () => router, useLocalSearchParams: () => params }));
vi.mock('../../../services/authMessages', () => ({ mapAuthErrorToHebrew: (code: string) => code }));
vi.mock('../../../services/authComposition', () => ({
  AUTH_RESET_PASSWORD_URL: 'kc://reset',
  getRequestPasswordResetUseCase: () => ({ execute: requestReset }),
  getResetPasswordUseCase: () => ({ execute: () => Promise.resolve() }),
  getVerifyEmailUseCase: () => ({ execute: verifyEmail }),
  exchangeOAuthCode: () => Promise.resolve({ userId: 'u1' }),
}));

import ForgotPasswordScreen from '../../../../app/(auth)/forgot-password';
import ResetPasswordScreen from '../../../../app/auth/reset-password';
import AuthVerifyScreen from '../../../../app/auth/verify';
import AuthCallbackScreen from '../../../../app/auth/callback';
import { renderInTheme } from '../../ui/__tests__/kitDialogTestKit';

beforeEach(() => {
  vi.clearAllMocks();
  params = {};
});
afterEach(cleanup);

describe('forgot-password screen', () => {
  it('submits the prefilled address through a busy primary button, then confirms', async () => {
    params = { email: 'dana@example.org' };
    let finish: () => void = () => {};
    requestReset.mockReturnValue(new Promise<void>((done) => (finish = done)));
    const { getByTestId, getByRole, findByTestId } = renderInTheme(<ForgotPasswordScreen />);
    const submit = getByTestId('forgot-password-submit');
    fireEvent.click(submit);
    expect(requestReset).toHaveBeenCalledWith({ email: 'dana@example.org', redirectTo: 'kc://reset' });
    expect(submit.getAttribute('aria-busy')).toBe('true');
    expect(getByRole('button', { name: 'auth.backToSignInCta' }).getAttribute('aria-disabled')).toBe('true');
    await act(async () => finish());
    fireEvent.click(await findByTestId('forgot-password-back'));
    expect(router.replace).toHaveBeenCalledWith('/(auth)/sign-in');
  });

  it('asks for an address instead of submitting an empty one', () => {
    const { getByTestId, getByText } = renderInTheme(<ForgotPasswordScreen />);
    fireEvent.click(getByTestId('forgot-password-submit'));
    expect(requestReset).not.toHaveBeenCalled();
    expect(getByText('auth.forgotPasswordEmailRequired')).toBeTruthy();
  });
});

describe('reset-password screen', () => {
  it('offers a new reset link when the link holds no token', () => {
    const { getByTestId, getByText } = renderInTheme(<ResetPasswordScreen />);
    expect(getByText('auth.resetPasswordInvalidLink')).toBeTruthy();
    fireEvent.click(getByTestId('reset-password-next'));
    expect(router.replace).toHaveBeenCalledWith('/(auth)/forgot-password');
  });

  it('blocks a mismatched confirmation before submitting', () => {
    params = { token_hash: 'hash' };
    const { getByTestId, getByText } = renderInTheme(<ResetPasswordScreen />);
    fireEvent.change(getByTestId('reset-password-new'), { target: { value: 'first-pass' } });
    fireEvent.click(getByTestId('reset-password-submit'));
    expect(getByText('auth.resetPasswordMismatch')).toBeTruthy();
  });
});

describe('verify and callback links', () => {
  it('shows progress while the e-mail link is exchanged', () => {
    params = { token_hash: 'hash' };
    verifyEmail.mockReturnValue(new Promise(() => {}));
    const { getByText, queryByRole } = renderInTheme(<AuthVerifyScreen />);
    expect(getByText('auth.verifyingProgress')).toBeTruthy();
    expect(queryByRole('button')).toBeNull();
  });

  it('sends a broken verification link back to sign-in', async () => {
    const { findByRole } = renderInTheme(<AuthVerifyScreen />);
    fireEvent.click(await findByRole('button', { name: 'auth.backToSignInCta' }));
    expect(router.replace).toHaveBeenCalledWith('/(auth)/sign-in');
  });

  it('sends a failed OAuth callback back to the welcome screen', async () => {
    params = { error: 'access_denied' };
    const { findByRole, getByText } = renderInTheme(<AuthCallbackScreen />);
    fireEvent.click(await findByRole('button', { name: 'auth.backToSignInCta' }));
    expect(getByText('access_denied')).toBeTruthy();
    expect(router.replace).toHaveBeenCalledWith('/(auth)');
  });
});
