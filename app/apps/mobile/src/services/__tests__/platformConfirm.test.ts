import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Alert, Platform } from 'react-native';

vi.mock('../../i18n', () => ({
  default: {
    t: (key: string) => `[t:${key}]`,
  },
}));

vi.mock('react-native', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-native');
  return {
    ...actual,
    Alert: {
      alert: vi.fn(),
    },
  };
});

import { confirmAction } from '../platformConfirm';

describe('confirmAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('on web', () => {
    const originalWindow = globalThis.window;

    beforeEach(() => {
      Platform.OS = 'web';
    });

    afterEach(() => {
      globalThis.window = originalWindow;
    });

    it('returns false when window is undefined', async () => {
      // @ts-expect-error simulating ssr or non-browser env
      delete globalThis.window;

      const result = await confirmAction('Title', 'Message');
      expect(result).toBe(false);
    });

    it('delegates to window.confirm when window is present', async () => {
      const confirmMock = vi.fn().mockReturnValue(true);
      globalThis.window = { confirm: confirmMock } as unknown as Window & typeof globalThis;

      const result = await confirmAction('Delete item?', 'This cannot be undone');
      expect(result).toBe(true);
      expect(confirmMock).toHaveBeenCalledWith('Delete item?\n\nThis cannot be undone');
    });
  });

  describe('on native platforms (iOS / Android)', () => {
    beforeEach(() => {
      Platform.OS = 'ios';
    });

    it('resolves true when confirm button is pressed', async () => {
      let confirmHandler: (() => void) | undefined;
      vi.mocked(Alert.alert).mockImplementation((_title, _message, buttons) => {
        confirmHandler = buttons?.[1]?.onPress;
      });

      const promise = confirmAction('Confirm Action', 'Proceed?');
      confirmHandler?.();

      await expect(promise).resolves.toBe(true);
      expect(Alert.alert).toHaveBeenCalledWith(
        'Confirm Action',
        'Proceed?',
        expect.arrayContaining([
          expect.objectContaining({ text: '[t:general.cancel]', style: 'cancel' }),
          expect.objectContaining({ text: '[t:general.confirm]', style: 'default' }),
        ]),
        expect.objectContaining({ onDismiss: expect.any(Function) }),
      );
    });

    it('resolves false when cancel button is pressed', async () => {
      let cancelHandler: (() => void) | undefined;
      vi.mocked(Alert.alert).mockImplementation((_title, _message, buttons) => {
        cancelHandler = buttons?.[0]?.onPress;
      });

      const promise = confirmAction('Confirm Action', 'Proceed?');
      cancelHandler?.();

      await expect(promise).resolves.toBe(false);
    });

    it('resolves false on alert dismiss', async () => {
      let dismissHandler: (() => void) | undefined;
      vi.mocked(Alert.alert).mockImplementation((_title, _message, _buttons, options) => {
        dismissHandler = options?.onDismiss;
      });

      const promise = confirmAction('Confirm Action', 'Proceed?');
      dismissHandler?.();

      await expect(promise).resolves.toBe(false);
    });

    it('applies custom button labels and destructive style', async () => {
      vi.mocked(Alert.alert).mockImplementation((_t, _m, buttons) => {
        buttons?.[1]?.onPress?.();
      });

      const result = await confirmAction('Delete Post', 'Are you sure?', {
        confirmLabel: 'Delete Now',
        cancelLabel: 'Keep Post',
        destructive: true,
      });

      expect(result).toBe(true);
      expect(Alert.alert).toHaveBeenCalledWith(
        'Delete Post',
        'Are you sure?',
        [
          expect.objectContaining({ text: 'Keep Post', style: 'cancel' }),
          expect.objectContaining({ text: 'Delete Now', style: 'destructive' }),
        ],
        expect.any(Object),
      );
    });
  });
});
