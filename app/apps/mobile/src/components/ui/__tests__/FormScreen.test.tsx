// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { Text, ThemeProvider } from '@kc/ui';
import { TextField } from '../TextField';

vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children, testID }: { children: React.ReactNode; testID?: string }) => (
    <div data-testid={testID ?? 'safe-area'}>{children}</div>
  ),
  useSafeAreaInsets: () => ({ top: 20, bottom: 34, left: 0, right: 0 }),
}));
vi.mock('@react-navigation/elements', () => ({ useHeaderHeight: () => 44 }));
vi.mock('../../../navigation/useShellTabBarVisibility', () => ({
  useShellTabBarVisibility: () => true,
  shellTabBarHeightPx: (visible: boolean) => (visible ? 48 : 0),
}));
vi.mock('react-native', async () => {
  const RN = await vi.importActual<typeof import('react-native')>('react-native');
  return {
    ...RN,
    InputAccessoryView: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    KeyboardAvoidingView: ({ children, keyboardVerticalOffset }: { children: React.ReactNode; keyboardVerticalOffset?: number }) => (
      <div data-testid="kav" data-offset={keyboardVerticalOffset ?? 0}>
        {children}
      </div>
    ),
    Platform: { OS: 'ios', select: (o: { ios?: unknown; default?: unknown }) => o.ios ?? o.default },
  };
});

import { FormScreen } from '../FormScreen';

afterEach(() => cleanup());

function renderForm(props: Partial<React.ComponentProps<typeof FormScreen>> = {}) {
  return render(
    <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
      <FormScreen
        testID="form-screen"
        footer={<Text>Footer CTA</Text>}
        {...props}
      >
        <Text>Field body</Text>
      </FormScreen>
    </ThemeProvider>,
  );
}

describe('FormScreen', () => {
  it('wraps content in SafeAreaView by default', () => {
    const { getByTestId, getByText } = renderForm();
    expect(getByTestId('form-screen')).toBeTruthy();
    expect(getByText('Field body')).toBeTruthy();
    expect(getByText('Footer CTA')).toBeTruthy();
  });

  it('skips SafeAreaView when embedded', () => {
    const { queryByTestId, getByTestId } = renderForm({ embedded: true, testID: 'embedded-form' });
    expect(queryByTestId('safe-area')).toBeNull();
    expect(getByTestId('embedded-form')).toBeTruthy();
  });

  it('passes keyboard offset in headerless mode on iOS', () => {
    const { getByTestId } = renderForm({ headerless: true });
    const kav = getByTestId('kav');
    expect(Number(kav.getAttribute('data-offset'))).toBe(20);
  });

  it('lifts the sticky footer above the shell tab bar when tabBarFooterInset is enabled', () => {
    const withInset = renderForm({ tabBarFooterInset: true });
    const footer = withInset.getByTestId('form-screen-footer') as HTMLElement;
    expect(footer.style.paddingBottom).toBe('64px');
    cleanup();
    const withoutInset = renderForm({ tabBarFooterInset: false });
    const plainFooter = withoutInset.getByTestId('form-screen-footer') as HTMLElement;
    expect(plainFooter.style.paddingBottom).toBe('');
  });

  it('joins TextFields to the form scope: Next return key and the keyboard toolbar, no per-form wiring', () => {
    const { getByLabelText, getByText } = render(
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
        <FormScreen>
          <TextField label="First" />
          <TextField label="Second" multiline />
        </FormScreen>
      </ThemeProvider>,
    );
    expect(getByLabelText('First').getAttribute('enterkeyhint')).toBe('next');
    // The toolbar is mounted by FormScreen itself.
    expect(getByText('common.formKeyboard.next')).toBeTruthy();
    expect(getByLabelText('Second').tagName).toBe('TEXTAREA');
  });

  it('keeps hand-wired forms hands-off when keyboardAccessory is passed', () => {
    const { getByLabelText } = render(
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
        <FormScreen
          keyboardAccessory={{ canGoPrev: false, canGoNext: false, onPrev: () => {}, onNext: () => {}, onDone: () => {} }}
        >
          <TextField label="Manual" returnKeyType="send" />
        </FormScreen>
      </ThemeProvider>,
    );
    expect(getByLabelText('Manual').getAttribute('enterkeyhint')).toBe('send');
  });
});
