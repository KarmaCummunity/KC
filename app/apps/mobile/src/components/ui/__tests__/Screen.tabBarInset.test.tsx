// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { type ViewStyle } from 'react-native';
import { Text } from '@kc/ui';
import { render } from '@testing-library/react';
import { Screen } from '../Screen';

vi.mock('../../../navigation/useShellTabBarVisibility', () => ({
  useShellTabBarVisibility: () => true,
  useShellTabBarScrollInset: () => 76, // 60 (pill) + 16 (extra)
  shellTabBarHeightPx: (v: boolean) => (v ? 60 : 0),
}));

// AmbientBlobs pulls in react-native-reanimated → react-native-worklets,
// which doesn't transform under Vitest. The blobs are purely decorative
// so stub them out entirely.
vi.mock('../AmbientBlobs', () => ({
  AmbientBlobs: () => null,
}));

// Stub safe-area-context: importing its real entry under jsdom blows up on
// untransformed TS. SafeAreaView is a passthrough for these tests.
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useSafeAreaInsets: () => ({ top: 0, bottom: 16, left: 0, right: 0 }),
}));

// Capture the contentContainerStyle Screen passes to its inner ScrollView.
// react-native-web's <ScrollView> renders the style onto an inner <div>, but
// we want to assert the *normalized* prop, not the post-flatten DOM. Mock the
// ScrollView export to spy on the prop directly.
const capturedContentStyles: unknown[] = [];
vi.mock('react-native', async () => {
  const actual = await vi.importActual<typeof import('react-native')>('react-native');
  return {
    ...actual,
    ScrollView: (props: {
      contentContainerStyle?: ViewStyle | ViewStyle[];
      children?: React.ReactNode;
    }) => {
      capturedContentStyles.push(props.contentContainerStyle);
      return <div data-testid="mock-scrollview">{props.children}</div>;
    },
  };
});

vi.mock('@kc/ui', async () => {
  const actual = await vi.importActual<typeof import('@kc/ui')>('@kc/ui');
  return { ...actual, useTheme: () => ({ colors: { surfaceCream: '#FFFBF7' }, isDark: false }) };
});

function flattenStyle(input: unknown): Record<string, unknown> {
  if (Array.isArray(input)) return Object.assign({}, ...input.filter(Boolean));
  return (input as Record<string, unknown>) ?? {};
}

describe('Screen — tab-bar inset wiring', () => {
  beforeEach(() => {
    capturedContentStyles.length = 0;
  });

  it('adds tab-bar paddingBottom to scrollable content when visible', () => {
    render(
      <Screen scroll tabBarInset>
        <Text>body</Text>
      </Screen>,
    );
    const style = flattenStyle(capturedContentStyles.at(-1));
    expect(style.paddingBottom).toBe(76);
  });

  it('omits tab-bar paddingBottom when tabBarInset=false', () => {
    render(
      <Screen scroll tabBarInset={false}>
        <Text>body</Text>
      </Screen>,
    );
    const style = flattenStyle(capturedContentStyles.at(-1));
    expect(style.paddingBottom).toBeUndefined();
  });
});
