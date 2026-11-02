// @vitest-environment jsdom
// Verification-pending panel on the kit buttons (FR-AUTH-006, spec 17 §4.1.1, TD-243):
// open mail, resend (busy, then held for the cooldown) and change address.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent } from '@testing-library/react';

const resend = vi.fn();
const openMail = vi.fn();

vi.mock('react-native-reanimated', async () => (await import('../../ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('expo-haptics', async () => (await import('../../ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('@expo/vector-icons', async () => (await import('../../ui/__tests__/kitDialogTestKit')).iconsDouble);
vi.mock('react-i18next', async () => (await import('../../ui/__tests__/kitDialogTestKit')).i18nDouble);
vi.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('../../../services/authMessages', () => ({ mapAuthErrorToHebrew: (code: string) => code }));
vi.mock('../../../lib/openMail', () => ({ openMail: (email: string) => openMail(email) }));
vi.mock('../../../services/authComposition', () => ({
  AUTH_VERIFY_URL: 'kc://verify',
  getResendVerificationEmailUseCase: () => ({ execute: resend }),
}));

import { VerificationPendingPanel } from '../VerificationPendingPanel';
import { renderInTheme } from '../../ui/__tests__/kitDialogTestKit';

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('VerificationPendingPanel', () => {
  it('opens the mail app for the pending address and lets the user change it', () => {
    const onChangeEmail = vi.fn();
    const { getByRole } = renderInTheme(<VerificationPendingPanel email="dana@example.org" onChangeEmail={onChangeEmail} />);
    fireEvent.click(getByRole('button', { name: 'auth.openMail' }));
    expect(openMail).toHaveBeenCalledWith('dana@example.org');
    fireEvent.click(getByRole('button', { name: 'auth.changeEmail' }));
    expect(onChangeEmail).toHaveBeenCalledTimes(1);
  });

  it('is busy while resending, then holds the resend for the cooldown', async () => {
    let finish: () => void = () => {};
    resend.mockReturnValue(new Promise<void>((done) => (finish = done)));
    const { getByRole, findByText } = renderInTheme(
      <VerificationPendingPanel email="dana@example.org" onChangeEmail={() => {}} />,
    );
    const button = getByRole('button', { name: 'auth.resendOtp' });
    fireEvent.click(button);
    expect(resend).toHaveBeenCalledWith({ email: 'dana@example.org', emailRedirectTo: 'kc://verify' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    await act(async () => finish());
    expect(await findByText('auth.resendOk')).toBeTruthy();
    const held = getByRole('button', { name: 'auth.resendWithCountdown' });
    expect(held.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(held);
    expect(resend).toHaveBeenCalledTimes(1);
  });
});
