// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('react-native', async () => {
  const RN = await vi.importActual<typeof import('react-native')>('react-native');
  return {
    ...RN,
    InputAccessoryView: ({ children, nativeID }: { children: React.ReactNode; nativeID?: string }) => (
      <div data-testid="input-accessory" data-native-id={nativeID}>
        {children}
      </div>
    ),
    Platform: { OS: 'ios', select: (o: { ios?: unknown; default?: unknown }) => o.ios ?? o.default },
  };
});

import { KeyboardFormAccessory } from '../KeyboardFormAccessory';

afterEach(() => cleanup());

describe('KeyboardFormAccessory', () => {
  it('renders prev / done / next labels on iOS', () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    const onDone = vi.fn();
    const { getByLabelText, getByTestId } = render(
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
        <KeyboardFormAccessory
          canGoPrev
          canGoNext
          onPrev={onPrev}
          onNext={onNext}
          onDone={onDone}
        />
      </ThemeProvider>,
    );
    expect(getByTestId('input-accessory')).toBeTruthy();
    fireEvent.click(getByLabelText('common.formKeyboard.prev'));
    fireEvent.click(getByLabelText('common.formKeyboard.next'));
    fireEvent.click(getByLabelText('common.formKeyboard.done'));
    expect(onPrev).toHaveBeenCalledOnce();
    expect(onNext).toHaveBeenCalledOnce();
    expect(onDone).toHaveBeenCalledOnce();
  });
});
