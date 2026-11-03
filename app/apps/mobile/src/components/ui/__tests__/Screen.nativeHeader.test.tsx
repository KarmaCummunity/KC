// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { Text } from '@kc/ui';
import { render } from '@testing-library/react';
import { Screen } from '../Screen';

vi.mock('../../../navigation/useShellTabBarVisibility', () => ({
  useShellTabBarVisibility: () => false,
  useShellTabBarScrollInset: () => 0,
  shellTabBarHeightPx: () => 0,
}));

// AmbientBlobs pulls in react-native-reanimated → react-native-worklets,
// which doesn't transform under Vitest. Stub them out — they're decorative.
vi.mock('../AmbientBlobs', () => ({
  AmbientBlobs: () => null,
}));

// Module-level test spy: plain mutable array, no Readonly + cast-mutation.
const sawEdges: Array<readonly string[]> = [];
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ edges, children }: { edges?: readonly string[]; children: React.ReactNode }) => {
    sawEdges.push(edges ?? []);
    return <>{children}</>;
  },
  useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }),
}));

vi.mock('@kc/ui', async () => {
  const actual = await vi.importActual<typeof import('@kc/ui')>('@kc/ui');
  return { ...actual, useTheme: () => ({ colors: { surfaceCream: '#FFFBF7' }, isDark: false }) };
});

describe('Screen — native-header double-padding guard', () => {
  beforeEach(() => {
    sawEdges.length = 0;
  });

  it('drops top edge when hasNativeHeader is set', () => {
    render(
      <Screen hasNativeHeader>
        <Text>body</Text>
      </Screen>,
    );
    expect(sawEdges.at(-1)).toEqual([]);
  });

  it('keeps top edge by default', () => {
    render(
      <Screen>
        <Text>body</Text>
      </Screen>,
    );
    expect(sawEdges.at(-1)).toEqual(['top']);
  });
});
