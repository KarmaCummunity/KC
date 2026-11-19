// @vitest-environment jsdom
// The logout confirmation (FR-SETTINGS-011 AC1): a dialog named by its question whose
// confirm signs out and whose cancel keeps the member signed in; busy while signing out.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';

vi.mock('react-native-reanimated', async () => (await import('../../ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('expo-haptics', async () => (await import('../../ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('react-native-safe-area-context', async () => (await import('../../ui/__tests__/kitDialogTestKit')).safeAreaDouble);
vi.mock('react-i18next', async () => (await import('../../ui/__tests__/kitDialogTestKit')).i18nDouble);
vi.mock('@expo/vector-icons', async () => (await import('../../ui/__tests__/kitDialogTestKit')).iconsDouble);
vi.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => false }));

import { renderInTheme } from '../../ui/__tests__/kitDialogTestKit';
import { SignOutConfirmModal } from '../SignOutConfirmModal';

afterEach(cleanup);

function renderModal(signingOut = false) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  renderInTheme(<SignOutConfirmModal visible signingOut={signingOut} onConfirm={onConfirm} onCancel={onCancel} />);
  return { onConfirm, onCancel };
}

describe('SignOutConfirmModal', () => {
  it('asks the logout question and signs out on confirm', () => {
    const { onConfirm, onCancel } = renderModal();
    expect(screen.getByRole('dialog', { name: 'settings.signOutConfirm.title' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'settings.logout' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('keeps the member signed in on cancel', () => {
    const { onConfirm, onCancel } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'general.cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('shows the confirm as busy while the sign-out runs', () => {
    renderModal(true);
    expect(screen.getByRole('button', { name: 'settings.logout' }).getAttribute('aria-busy')).toBe('true');
  });
});
