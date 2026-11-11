// FR-ADMIN-002..005 — `confirmAndRun` tells the caller when the admin backs out
// of the confirmation (TD-251), so a caller that marked itself busy can reset.
import { afterEach, describe, expect, it, vi } from 'vitest';

type AlertButton = { text: string; style?: string; onPress?: () => void };
type AlertOptions = { cancelable?: boolean; onDismiss?: () => void };

const rn = vi.hoisted(() => ({
  Platform: { OS: 'ios' as string },
  Alert: { alert: vi.fn() },
  ToastAndroid: { show: vi.fn(), SHORT: 0 },
}));
vi.mock('react-native', () => rn);
vi.mock('../../../../i18n', () => ({ default: { t: (key: string) => key } }));

import { ModerationError, ModerationForbiddenError } from '@kc/application';
import { BackendUnavailableError } from '@kc/domain';
import { confirmAndRun } from '../adminActions';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function handlers() {
  return { onConfirm: vi.fn(() => Promise.resolve()), onSuccess: vi.fn(), onError: vi.fn(), onCancel: vi.fn() };
}

/** Opens the native confirm and returns its buttons and options. */
function openNative(h: ReturnType<typeof handlers>) {
  rn.Platform.OS = 'ios';
  confirmAndRun({ action: 'ban', ...h });
  const [, , buttons, options] = rn.Alert.alert.mock.calls[0] as [string, string, AlertButton[], AlertOptions];
  return { buttons, options };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('confirmAndRun — web', () => {
  it('calls onCancel and runs nothing when the admin declines', () => {
    rn.Platform.OS = 'web';
    vi.stubGlobal('window', { confirm: vi.fn(() => false) });
    const h = handlers();
    confirmAndRun({ action: 'ban', ...h });
    expect(h.onCancel).toHaveBeenCalledTimes(1);
    expect(h.onConfirm).not.toHaveBeenCalled();
  });

  it('runs the action and not onCancel when the admin confirms', async () => {
    rn.Platform.OS = 'web';
    vi.stubGlobal('window', { confirm: vi.fn(() => true) });
    const h = handlers();
    confirmAndRun({ action: 'ban', ...h });
    await flush();
    expect(h.onConfirm).toHaveBeenCalledTimes(1);
    expect(h.onSuccess).toHaveBeenCalledTimes(1);
    expect(h.onCancel).not.toHaveBeenCalled();
  });
});

describe('confirmAndRun — native', () => {
  it('calls onCancel from the cancel button', () => {
    const h = handlers();
    const { buttons } = openNative(h);
    buttons.find((b) => b.style === 'cancel')?.onPress?.();
    expect(h.onCancel).toHaveBeenCalledTimes(1);
    expect(h.onConfirm).not.toHaveBeenCalled();
  });

  it('calls onCancel when the alert is dismissed from outside (Android)', () => {
    const h = handlers();
    const { options } = openNative(h);
    expect(options.cancelable).toBe(true);
    options.onDismiss?.();
    expect(h.onCancel).toHaveBeenCalledTimes(1);
  });

  it('reports an error from the proceed button and does not cancel', async () => {
    const h = handlers();
    h.onConfirm.mockImplementationOnce(() => Promise.reject(new Error('offline')));
    const { buttons } = openNative(h);
    buttons.find((b) => b.style === 'destructive')?.onPress?.();
    await flush();
    expect(h.onError).toHaveBeenCalledWith('moderation.actions.errors.networkError');
    expect(h.onCancel).not.toHaveBeenCalled();
  });

  it('works without an onCancel', () => {
    const { onCancel: _unused, ...h } = handlers();
    rn.Platform.OS = 'ios';
    confirmAndRun({ action: 'restore', ...h });
    const [, , buttons] = rn.Alert.alert.mock.calls[0] as [string, string, AlertButton[]];
    expect(() => buttons[0]?.onPress?.()).not.toThrow();
  });
});

describe('confirmAndRun — error messages', () => {
  /** Runs an action that fails with `failure` and returns the message handed to onError. */
  async function failWith(failure: unknown): Promise<string> {
    rn.Platform.OS = 'web';
    vi.stubGlobal('window', { confirm: vi.fn(() => true) });
    const h = { ...handlers(), onConfirm: vi.fn(() => Promise.reject(failure)) };
    confirmAndRun({ action: 'ban', ...h });
    await flush();
    return h.onError.mock.calls[0]?.[0] as string;
  }

  it.each([
    [new ModerationForbiddenError(), 'moderation.actions.errors.forbidden'],
    [new ModerationError('cannot_sanction_self'), 'moderation.actions.errors.cannotSanctionSelf'],
    [new ModerationError('cannot_sanction_admin'), 'moderation.actions.errors.cannotSanctionAdmin'],
    [new ModerationError('account_pending_deletion'), 'moderation.actions.errors.accountPendingDeletion'],
    [new ModerationError('invalid_sanction_reason'), 'moderation.actions.errors.invalidSanctionReason'],
    [new ModerationError('invalid_target_state'), 'moderation.actions.errors.invalidTargetState'],
    [new ModerationError('report_not_open'), 'moderation.actions.errors.reportNotOpen'],
    [new ModerationError('target_not_found'), 'moderation.actions.errors.targetNotFound'],
    [new ModerationError('message_not_found'), 'moderation.actions.errors.messageNotFound'],
    [new ModerationError('unknown'), 'moderation.actions.errors.networkError'],
    [new Error('socket closed'), 'moderation.actions.errors.networkError'],
  ])('maps %s to its locale key', async (failure, key) => {
    expect(await failWith(failure)).toBe(key);
  });

  it('says "not available yet" when the backend object is missing (degrade rule)', async () => {
    expect(await failWith(new BackendUnavailableError('rpc:admin_restore_chat', 'function'))).toBe('backend.notAvailableYet');
  });
});
