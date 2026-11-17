// @vitest-environment jsdom
// Desktop-width web: the navigation rail is for signed-in members only (KC#2381,
// FR-RESP-002, FR-RESEARCH-001 AC2). The phone-width invariant lives in AppShell.snapshot.test.tsx.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { Text } from '@kc/ui';
import { useAuthStore } from '../../../store/authStore';
import { AppShell } from '../AppShell';

// The route the shell believes it is on; each test sets it.
const route = vi.hoisted(() => ({ segments: [] as string[] }));

vi.mock('expo-router', () => ({
  useSegments: () => route.segments,
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/',
  Redirect: () => null,
}));

// @expo/vector-icons ships ESM-in-CJS, which Vitest cannot parse.
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'he' } }),
}));

// A 1280px web viewport: the desktop breakpoint, where AppShell lays out rail + main + aside.
vi.mock('react-native', async () => {
  const actual = await vi.importActual<typeof import('react-native')>('react-native');
  return {
    ...actual,
    useWindowDimensions: () => ({ width: 1280, height: 720, scale: 1, fontScale: 1 }),
    Platform: { ...actual.Platform, OS: 'web' as const },
  };
});

function renderShell(session: { isAuthenticated: boolean; isLoading?: boolean }, segments: string[]) {
  route.segments = segments;
  useAuthStore.setState({ isAuthenticated: session.isAuthenticated, isLoading: session.isLoading ?? false });
  return render(
    <AppShell>
      <Text testID="child">child content</Text>
    </AppShell>,
  );
}

describe('AppShell — desktop web (1280px)', () => {
  afterEach(cleanup);

  it('shows the navigation rail to a signed-in member', () => {
    const { queryAllByRole, queryByTestId } = renderShell({ isAuthenticated: true }, ['(tabs)']);
    expect(queryByTestId('child')?.textContent).toBe('child content');
    expect(queryAllByRole('tab').length).toBeGreaterThan(0);
  });

  it('keeps the rail on a chat thread', () => {
    const { queryAllByRole } = renderShell({ isAuthenticated: true }, ['chat', '[id]']);
    expect(queryAllByRole('tab').length).toBeGreaterThan(0);
  });

  it.each([[['(auth)']], [['about']], [['legal', 'terms']], [['research', '[slug]']]])(
    'renders the page alone for a signed-out visitor on %j',
    (segments) => {
      const { queryByRole, queryByTestId } = renderShell({ isAuthenticated: false }, segments);
      expect(queryByTestId('child')?.textContent).toBe('child content');
      expect(queryByRole('tab')).toBeNull();
    },
  );

  it('renders the public research form without app navigation for a signed-in member too', () => {
    const { queryByRole } = renderShell({ isAuthenticated: true }, ['research', '[slug]']);
    expect(queryByRole('tab')).toBeNull();
  });

  it('shows no rail while the session is being restored', () => {
    const { queryByRole } = renderShell({ isAuthenticated: true, isLoading: true }, ['(tabs)']);
    expect(queryByRole('tab')).toBeNull();
  });
});
