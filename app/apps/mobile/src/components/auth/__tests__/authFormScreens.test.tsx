// @vitest-environment jsdom
// Email sign-in / sign-up on the kit buttons (FR-AUTH-006 / FR-AUTH-007, spec 17 §4.1.1, TD-243):
// the submit runs the use case and is busy meanwhile, and the links route to the sibling screens.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react';

const router = { back: vi.fn(), push: vi.fn(), replace: vi.fn() };
const signIn = vi.fn();
const signUp = vi.fn();

vi.mock('react-native-reanimated', async () => (await import('../../ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('expo-haptics', async () => (await import('../../ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('@expo/vector-icons', async () => (await import('../../ui/__tests__/kitDialogTestKit')).iconsDouble);
vi.mock('react-i18next', async () => (await import('../../ui/__tests__/kitDialogTestKit')).i18nDouble);
vi.mock('react-native-safe-area-context', async () => (await import('../../ui/__tests__/kitDialogTestKit')).safeAreaDouble);
vi.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('../../../hooks/useModalHardwareBack', () => ({ useModalHardwareBack: () => {} }));
vi.mock('expo-router', () => ({ useRouter: () => router }));
vi.mock('../../ui/AmbientBlobs', () => ({ AmbientBlobs: () => null }));
vi.mock('../AuthSocialSignInBlock', () => ({ AuthSocialSignInBlock: () => null }));
vi.mock('../../../services/authMessages', () => ({ mapAuthErrorToHebrew: (code: string) => code }));
vi.mock('../../../lib/analyticsCoreLoop', () => ({ trackCoreLoop: () => {} }));
vi.mock('../../../services/authComposition', () => ({
  AUTH_VERIFY_URL: 'kc://verify',
  getSignInUseCase: () => ({ execute: signIn }),
  getSignUpUseCase: () => ({ execute: signUp }),
  getResendVerificationEmailUseCase: () => ({ execute: () => Promise.resolve() }),
}));

import SignInScreen from '../../../../app/(auth)/sign-in';
import SignUpScreen from '../../../../app/(auth)/sign-up';
import { renderInTheme } from '../../ui/__tests__/kitDialogTestKit';
import { useAuthStore } from '../../../store/authStore';

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ setSession: vi.fn() } as never);
});
afterEach(cleanup);

/** A use-case call that stays pending until `resolve` runs. */
function deferred() {
  let resolve: (value: unknown) => void = () => {};
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Types an address and a password into the form's two inputs (in screen order). */
function fillCredentials() {
  const [email, password] = Array.from(document.querySelectorAll('input'));
  fireEvent.change(email, { target: { value: 'dana@example.org' } });
  fireEvent.change(password, { target: { value: 'secret-pass' } });
}

describe('sign-in screen', () => {
  it('asks for both fields before calling the use case', () => {
    const { getByRole, getByText } = renderInTheme(<SignInScreen />);
    fireEvent.click(getByRole('button', { name: 'auth.signIn' }));
    expect(signIn).not.toHaveBeenCalled();
    expect(getByText('auth.fillEmailAndPassword')).toBeTruthy();
  });

  it('runs the sign-in and keeps the submit busy while it runs', async () => {
    const call = deferred();
    signIn.mockReturnValue(call.promise);
    const { getByRole, getByTestId } = renderInTheme(<SignInScreen />);
    fillCredentials();
    fireEvent.click(getByTestId('auth-submit'));
    expect(signIn).toHaveBeenCalledWith({ email: 'dana@example.org', password: 'secret-pass' });
    const submit = getByRole('button', { name: 'auth.signIn' });
    expect(submit.getAttribute('aria-busy')).toBe('true');
    expect(getByRole('button', { name: 'auth.forgotPassword' }).getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(submit);
    expect(signIn).toHaveBeenCalledTimes(1);
    await act(async () => call.resolve({ session: { userId: 'u1' } }));
    await waitFor(() => expect(submit.getAttribute('aria-busy')).toBe('false'));
  });

  it('shows the verification panel for an unconfirmed address and the mapped error otherwise', async () => {
    const { AuthError } = await import('@kc/application');
    signIn.mockRejectedValueOnce(new AuthError('email_not_verified', 'unverified'));
    const { getByRole, findByText } = renderInTheme(<SignInScreen />);
    fillCredentials();
    fireEvent.click(getByRole('button', { name: 'auth.signIn' }));
    expect(await findByText('auth.verifyTitle')).toBeTruthy();
    cleanup();

    signIn.mockRejectedValueOnce(new AuthError('invalid_credentials', 'bad'));
    const second = renderInTheme(<SignInScreen />);
    fillCredentials();
    fireEvent.click(second.getByRole('button', { name: 'auth.signIn' }));
    expect(await second.findByText('invalid_credentials')).toBeTruthy();
    expect(second.getByText('auth.signInFailedTitle')).toBeTruthy();
  });

  it('opens the forgot-password form with the typed address and switches to sign-up', () => {
    const { getByRole } = renderInTheme(<SignInScreen />);
    fillCredentials();
    fireEvent.click(getByRole('button', { name: 'auth.forgotPassword' }));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/(auth)/forgot-password',
      params: { email: 'dana@example.org' },
    });
    fireEvent.click(getByRole('button', { name: 'auth.noAccountSwitchCta' }));
    expect(router.replace).toHaveBeenCalledWith('/(auth)/sign-up');
  });
});

describe('sign-up screen', () => {
  it('runs the sign-up and swaps the form for the verification panel', async () => {
    signUp.mockResolvedValue({ session: null, pendingVerification: true });
    const { getByRole, findByText } = renderInTheme(<SignUpScreen />);
    fillCredentials();
    fireEvent.click(getByRole('button', { name: 'auth.signUp' }));
    expect(signUp).toHaveBeenCalledWith({
      email: 'dana@example.org',
      password: 'secret-pass',
      emailRedirectTo: 'kc://verify',
    });
    expect(await findByText('auth.verifyTitle')).toBeTruthy();
  });

  it('switches to sign-in from the footer link', () => {
    const { getByRole } = renderInTheme(<SignUpScreen />);
    fireEvent.click(getByRole('button', { name: 'auth.hasAccountSwitchCta' }));
    expect(router.replace).toHaveBeenCalledWith('/(auth)/sign-in');
  });
});
