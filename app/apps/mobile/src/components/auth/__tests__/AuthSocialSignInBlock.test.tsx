// @vitest-environment jsdom
// Email sign-in / sign-up reading order (FR-AUTH-007 AC7, FR-AUTH-006): title → social sign-in →
// the "or" divider → the email form. The divider used to render above the Google button.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { Platform } from 'react-native';
import { ThemeProvider } from '@kc/ui';

vi.mock('react-native-reanimated', async () => {
  const { View } = await vi.importActual<typeof import('react-native')>('react-native');
  const same = <T,>(value: T) => value;
  return {
    default: { View },
    useSharedValue: (value: number) => ({ value }),
    useAnimatedStyle: () => ({}),
    withSpring: same,
    withTiming: same,
    withDelay: (_delay: number, value: unknown) => value,
  };
});
vi.mock('react-native-safe-area-context', async () => {
  const { View } = await vi.importActual<typeof import('react-native')>('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
vi.mock('expo-haptics', async () => (await import('../../ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('react-i18next', async () => (await import('../../ui/__tests__/kitDialogTestKit')).i18nDouble);
vi.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name, color }: { name: string; color?: string }) => <span data-testid={`icon-${name}`} data-color={color} />,
}));
vi.mock('expo-router', () => ({ useRouter: () => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));
vi.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('../../../hooks/useModalHardwareBack', () => ({ useModalHardwareBack: () => {} }));
vi.mock('../../ui/AmbientBlobs', () => ({ AmbientBlobs: () => null }));
vi.mock('../../../services/authMessages', () => ({ mapAuthErrorToHebrew: (code: string) => code }));
vi.mock('../../../lib/analyticsCoreLoop', () => ({ trackCoreLoop: () => {} }));
vi.mock('../../../services/authComposition', () => {
  const useCase = () => ({ execute: () => Promise.resolve({}) });
  return {
    AUTH_VERIFY_URL: 'kc://verify',
    getSignInUseCase: useCase,
    getSignUpUseCase: useCase,
    getResendVerificationEmailUseCase: useCase,
    getSignInWithGoogleUseCase: useCase,
    getSignInWithAppleUseCase: useCase,
    getOAuthRedirectUri: () => 'kc://callback',
    redirectToGoogleSignInWeb: () => Promise.resolve(),
  };
});

import SignInScreen from '../../../../app/(auth)/sign-in';
import SignUpScreen from '../../../../app/(auth)/sign-up';
import { AuthSocialSignInBlock } from '../AuthSocialSignInBlock';

const originalOs = Platform.OS;
afterEach(() => {
  cleanup();
  Platform.OS = originalOs;
});

const renderInTheme = (ui: React.ReactElement, scheme: 'light' | 'dark' = 'light') =>
  render(<ThemeProvider mode={scheme} systemScheme={scheme} setMode={() => {}}>{ui}</ThemeProvider>);

/** Each element comes after the previous one in document (reading) order. */
function expectReadingOrder(...elements: Element[]) {
  elements.slice(1).forEach((element, index) => {
    const previous = elements[index];
    expect(previous.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
}

describe('social sign-in block', () => {
  it('puts the "or" divider after the social buttons, so it leads into the form below', () => {
    const { getByText } = renderInTheme(<AuthSocialSignInBlock />);
    expectReadingOrder(getByText('auth.continueWithGoogle'), getByText('auth.orDivider'));
  });

  it('keeps the Apple button\'s logo and spinner in its label colour in dark mode', () => {
    Platform.OS = 'ios';
    const { getByText, getByTestId } = renderInTheme(<AuthSocialSignInBlock />, 'dark');
    const label = getByText('auth.continueWithApple');
    // jsdom resolves the label colour to rgb(); the icon double keeps the raw prop.
    const ink = getComputedStyle(label).color;
    const probe = document.createElement('span');
    probe.style.color = getByTestId('icon-logo-apple').getAttribute('data-color') ?? '';
    expect(probe.style.color).toBe(ink);
  });
});

describe.each([
  ['sign-in', SignInScreen, 'auth.signInScreenTitle'],
  ['sign-up', SignUpScreen, 'auth.signUp'],
])('%s screen', (_name, Screen, titleKey) => {
  it('reads title → Google → "or" → email form', () => {
    const { getAllByText, getByText, container } = renderInTheme(<Screen />);
    // The form's first field is the e-mail address.
    const firstField = container.querySelector('input');
    expect(firstField).not.toBeNull();
    expectReadingOrder(
      getAllByText(titleKey)[0],
      getByText('auth.continueWithGoogle'),
      getByText('auth.orDivider'),
      firstField!,
    );
  });
});
