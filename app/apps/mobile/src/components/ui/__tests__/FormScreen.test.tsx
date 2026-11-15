// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { Text, ThemeProvider } from '@kc/ui';

// Mutable so a test can render the form as another platform (the mocked `Platform.OS` reads it live).
const platform = vi.hoisted(() => ({ OS: 'ios' as 'ios' | 'android' }));

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
    KeyboardAvoidingView: ({
      children,
      keyboardVerticalOffset,
      behavior,
    }: {
      children: React.ReactNode;
      keyboardVerticalOffset?: number;
      behavior?: string;
    }) => (
      <div data-testid="kav" data-offset={keyboardVerticalOffset ?? 0} data-behavior={behavior ?? ''}>
        {children}
      </div>
    ),
    Platform: {
      get OS() {
        return platform.OS;
      },
      select: (o: { ios?: unknown; default?: unknown }) => o.ios ?? o.default,
    },
  };
});

import { FormScreen } from '../FormScreen';

afterEach(() => {
  cleanup();
  platform.OS = 'ios';
});

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

  it('pads the bottom on iOS so the sticky footer clears the keyboard', () => {
    expect(renderForm().getByTestId('kav').getAttribute('data-behavior')).toBe('padding');
  });

  // FR-RESP-006 AC5: edge-to-edge Android does not resize the window, so the view must shrink itself
  // or the keyboard covers the footer (Maestro flow 19, edit profile).
  it('shrinks the height on Android so the sticky footer clears the keyboard', () => {
    platform.OS = 'android';
    expect(renderForm().getByTestId('kav').getAttribute('data-behavior')).toBe('height');
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
});
