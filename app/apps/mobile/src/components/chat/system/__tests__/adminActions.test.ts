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
