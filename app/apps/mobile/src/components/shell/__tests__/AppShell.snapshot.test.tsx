// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { Text } from '@kc/ui';
import { AppShell } from '../AppShell';

// Stub expo-router so the test does not need a real router context.
vi.mock('expo-router', () => ({
  useSegments: () => [],
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/',
  Redirect: () => null,
}));

// Stub @expo/vector-icons — it ships ESM-in-CJS which Vitest cannot parse,
// and we never render any icon on the mobile passthrough path anyway. The
// import lives in NavigationRail.tsx, which is a top-level import in
// AppShell.tsx but is never invoked at mobile (<768) breakpoints.
vi.mock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

// react-i18next is pulled in transitively by NavigationRail; stub useTranslation
// so its module evaluation doesn't fault even though we never render any rail item.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'he' } }),
}));

// Force the mobile breakpoint by mocking useWindowDimensions to 375px,
// AND force Platform.OS = 'web' to exercise the web code path (which is what
// the mobile invariant is really about — making sure web at <768 stays a
// passthrough, identical to native).
vi.mock('react-native', async () => {
  const actual = await vi.importActual<typeof import('react-native')>('react-native');
  return {
    ...actual,
    useWindowDimensions: () => ({ width: 375, height: 812, scale: 2, fontScale: 1 }),
    Platform: { ...actual.Platform, OS: 'web' as const },
  };
});

describe('AppShell — mobile invariant (375px on web)', () => {
  it('renders only its children, no rail or aside', () => {
    const { container, queryByTestId, queryByRole } = render(
      <AppShell>
        <Text testID="child">child content</Text>
      </AppShell>
    );
    expect(queryByTestId('child')?.textContent).toBe('child content');
    // NavigationRail items use accessibilityRole="tab" — there should be none.
    expect(queryByRole('tab')).toBeNull();
    // Snapshot the rendered HTML — any future regression in the mobile path
    // will break this assertion and must be reviewed by hand.
    expect(container.innerHTML).toMatchSnapshot();
  });
});
