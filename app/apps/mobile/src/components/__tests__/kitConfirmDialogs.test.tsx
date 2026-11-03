// @vitest-environment jsdom
// Confirmation dialogs on the kit `Modal` (spec 17 §4.1.1, TD-243): each renders
// as a named dialog, runs its confirm path, dismisses, and puts a destructive
// confirm on the red `DangerButton` (D94).
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { lightColors } from '@kc/ui';
import { DeleteAccountError } from '@kc/application';

vi.mock('react-native-reanimated', async () => (await import('../ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('expo-haptics', async () => (await import('../ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('react-native-safe-area-context', async () => (await import('../ui/__tests__/kitDialogTestKit')).safeAreaDouble);
vi.mock('react-i18next', async () => (await import('../ui/__tests__/kitDialogTestKit')).i18nDouble);
vi.mock('@expo/vector-icons', async () => (await import('../ui/__tests__/kitDialogTestKit')).iconsDouble);
vi.mock('../../hooks/useReducedMotion', () => ({ useReducedMotion: () => false }));

import { renderInTheme, rgb } from '../ui/__tests__/kitDialogTestKit';
import { ConfirmActionModal } from '../post/ConfirmActionModal';
import { HideChatConfirmModal } from '../HideChatConfirmModal';
import { ReopenConfirmModal } from '../closure/ReopenConfirmModal';
import { DeleteAccountConfirmModal } from '../DeleteAccountConfirmModal';

afterEach(cleanup);

const background = (element: HTMLElement) => getComputedStyle(element).backgroundColor;

describe('ConfirmActionModal', () => {
  function renderConfirm(props: Partial<ComponentProps<typeof ConfirmActionModal>> = {}) {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    renderInTheme(
      <ConfirmActionModal
        visible
        title="Delete post?"
        message="This cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={onConfirm}
        onCancel={onCancel}
        {...props}
      />,
    );
    return { onConfirm, onCancel };
  }

  it('renders a dialog named by its title with a red confirm for a destructive action', () => {
    const { onConfirm } = renderConfirm();
    expect(screen.getByRole('dialog', { name: 'Delete post?' })).toBeTruthy();
    expect(screen.getByText('This cannot be undone.')).toBeTruthy();
    const confirm = screen.getByRole('button', { name: 'Delete' });
    expect(background(confirm)).toBe(rgb(lightColors.error));
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('uses the brand primary for a non-destructive confirm', () => {
    renderConfirm({ destructive: false, confirmLabel: 'Publish' });
    expect(background(screen.getByRole('button', { name: 'Publish' }))).toBe(rgb(lightColors.primary));
  });

  it('dismisses from the cancel button, the ✕ and Escape', () => {
    const { onCancel } = renderConfirm({ cancelLabel: 'Keep' });
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    fireEvent.click(screen.getByRole('button', { name: 'general.close' }));
    fireEvent.keyUp(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(3);
  });

  it('holds the dialog while busy: confirm spins, cancel and the ✕ are blocked', () => {
    const { onConfirm, onCancel } = renderConfirm({ isBusy: true, errorMessage: 'Network error' });
    expect(screen.getByRole('button', { name: 'Delete' }).getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByRole('button', { name: 'general.close' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'general.cancel' }));
    fireEvent.keyUp(document, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText('Network error')).toBeTruthy();
  });
});

describe('HideChatConfirmModal', () => {
  it('confirms on a red button and cancels', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    renderInTheme(<HideChatConfirmModal visible loading={false} onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.getByRole('dialog', { name: 'chat.hideFromInboxTitle' })).toBeTruthy();
    const confirm = screen.getByRole('button', { name: 'chat.hideFromInboxConfirm' });
    expect(background(confirm)).toBe(rgb(lightColors.error));
    fireEvent.click(confirm);
    fireEvent.click(screen.getByRole('button', { name: 'chat.hideFromInboxCancel' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('ReopenConfirmModal', () => {
  it('lists the consequences of reopening a delivered post, confirms and cancels', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    renderInTheme(
      <ReopenConfirmModal
        visible
        variant="closed_delivered"
        postType="Give"
        isBusy={false}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'closure.itemNotDeliveredModalTitle' })).toBeTruthy();
    expect(screen.getByText('closure.reopenBulletOwnerCounter')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'closure.reopenConfirmCta' }));
    fireEvent.click(screen.getByRole('button', { name: 'general.cancel' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('DeleteAccountConfirmModal', () => {
  const DELETE = 'settings.deleteAccountModal.buttons.delete';

  function renderDelete(onConfirm: () => Promise<void>, accountStatus: 'active' | 'banned' = 'active') {
    const onCancel = vi.fn();
    renderInTheme(
      <DeleteAccountConfirmModal visible accountStatus={accountStatus} onConfirm={onConfirm} onCancel={onCancel} />,
    );
    return { onCancel };
  }

  it('enables the red delete only once the keyword is typed, then confirms', async () => {
    const onConfirm = vi.fn(() => Promise.resolve());
    renderDelete(onConfirm);
    const remove = screen.getByRole('button', { name: DELETE });
    expect(background(remove)).toBe(rgb(lightColors.error));
    expect(remove.getAttribute('aria-disabled')).toBe('true');
    fireEvent.change(screen.getByLabelText('settings.deleteAccountModal.confirmInputLabel'), {
      target: { value: 'settings.deleteAccountModal.confirmKeyword' },
    });
    fireEvent.click(screen.getByRole('button', { name: DELETE }));
    await vi.waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  });

  it('becomes blocking after a critical failure: retry only, no cancel, no ✕', async () => {
    const onConfirm = vi.fn(() => Promise.reject(new DeleteAccountError('auth_delete_failed', 'auth delete failed')));
    const { onCancel } = renderDelete(onConfirm);
    fireEvent.change(screen.getByLabelText('settings.deleteAccountModal.confirmInputLabel'), {
      target: { value: 'settings.deleteAccountModal.confirmKeyword' },
    });
    fireEvent.click(screen.getByRole('button', { name: DELETE }));
    await screen.findByRole('button', { name: 'settings.deleteAccountModal.buttons.retry' });
    expect(screen.queryByRole('button', { name: 'settings.deleteAccountModal.buttons.cancel' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'general.close' })).toBeNull();
    fireEvent.keyUp(document, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('tells a suspended account it cannot delete, and closes', () => {
    const { onCancel } = renderDelete(vi.fn(), 'banned');
    expect(screen.getByRole('dialog', { name: 'settings.deleteAccountModal.blocked.title' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'settings.deleteAccountModal.buttons.close' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
