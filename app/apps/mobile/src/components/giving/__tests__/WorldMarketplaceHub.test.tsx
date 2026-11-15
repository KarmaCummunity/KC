// @vitest-environment jsdom
// FR-FEED-020 AC2 — a giving world's screen: the TopBar carries the world's screens menu, the map
// and a filter button; the feed is the main feed's posts query narrowed to the world, filtered
// through the main feed's sheet with the world locked; an empty, filtered feed offers to clear.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@kc/ui';
import type { PostFilterValue } from '../../PostFilterSheet';

type FeedPost = { postId: string };
type SheetProps = {
  visible: boolean;
  lockedWorld?: boolean;
  onPatch: (p: Partial<PostFilterValue>) => void;
  onClear: () => void;
};

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  execute: vi.fn(),
  sheet: { last: null as SheetProps | null },
}));

vi.mock('react-native-reanimated', async () => (await import('../../ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('expo-haptics', async () => (await import('../../ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('react-native-safe-area-context', async () => (await import('../../ui/__tests__/kitDialogTestKit')).safeAreaDouble);
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'he' } }),
}));
vi.mock('expo-router', () => ({
  useRouter: () => ({ push: mocks.push }),
  useNavigation: () => ({ setOptions: (o: HeaderOptions) => header.set(o) }),
}));
vi.mock('../../../hooks/useAdminRoles', () => ({ useAdminRoles: () => ({ roles: [] }) }));
vi.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('../../../hooks/useModalHardwareBack', () => ({ useModalHardwareBack: () => {} }));
vi.mock('../../../hooks/usePrefetchNextPage', () => ({ usePrefetchNextPage: () => {} }));
vi.mock('../../../store/authStore', () => ({
  useAuthStore: (sel: (s: { session: { userId: string } }) => unknown) => sel({ session: { userId: 'viewer-1' } }),
}));
vi.mock('../../../services/postsComposition', () => ({ getFeedUseCase: () => ({ execute: mocks.execute }) }));
// Surfaces with their own tests and their own I/O.
vi.mock('../../ui/Screen', () => ({ Screen: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../WorldLinksPreview', () => ({ WorldLinksPreview: () => null }));
vi.mock('../../PostFeedList', () => ({
  PostFeedList: ({ data, isLoading, emptyComponent }: { data?: FeedPost[]; isLoading: boolean; emptyComponent?: React.ReactNode }) => (
    <div>
      {data?.map((p) => <div key={p.postId} data-testid={`post-${p.postId}`} />)}
      {!isLoading && data?.length === 0 ? emptyComponent : null}
    </div>
  ),
}));
vi.mock('../../PostFilterSheet', () => ({
  PostFilterSheet: (props: SheetProps) => {
    mocks.sheet.last = props;
    return props.visible ? <div data-testid="post-filter-sheet" /> : null;
  },
}));

import { WorldMarketplaceHub } from '../WorldMarketplaceHub';
import { worldSubScreens } from '../worldSubScreens';

type HeaderOptions = { headerTitle?: () => React.ReactNode; headerRight?: () => React.ReactNode };
const header = { set: (_o: HeaderOptions) => {} };
/** Renders what the hub puts into the stack header, as the TopBar would. */
function HeaderHost() {
  const [options, setOptions] = React.useState<HeaderOptions>({});
  header.set = (o) => setOptions(o);
  return (
    <>
      {options.headerTitle?.()}
      {options.headerRight?.()}
    </>
  );
}

beforeEach(() => {
  mocks.execute.mockResolvedValue({ posts: [{ postId: 'p1' }, { postId: 'p2' }], nextCursor: null });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.sheet.last = null;
});

function renderHub() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
        <HeaderHost />
        <WorldMarketplaceHub
          worldSlug="food"
          icon="restaurant-outline"
          introKey="givingHandoff.foodHubIntro"
          subScreens={worldSubScreens('/(tabs)/donations/food/handoffs')}
        />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const lastFeedFilter = () => mocks.execute.mock.calls.at(-1)?.[0]?.filter;
const patchFilters = (p: Partial<PostFilterValue>) => mocks.sheet.last?.onPatch(p);

describe('WorldMarketplaceHub — the world feed', () => {
  it('opens the world screens menu from the title and links the sub-screens', () => {
    renderHub();
    expect(screen.queryByTestId('world-hub-my-handoffs')).toBeNull();
    fireEvent.click(screen.getByTestId('world-screens-menu-toggle'));
    expect(screen.getByTestId('world-menu-feed')).toBeTruthy();
    fireEvent.click(screen.getByTestId('world-hub-my-handoffs'));
    expect(mocks.push).toHaveBeenLastCalledWith('/(tabs)/donations/food/handoffs');
  });

  it("opens the map on this world's feed, with the feed's filter (FR-FEED-021)", () => {
    renderHub();
    fireEvent.click(screen.getByTestId('world-open-map'));
    const call = mocks.push.mock.lastCall?.[0] as { pathname: string; params: { world: string; filter: string } };
    expect(call.pathname).toBe('/(tabs)/donations/marketplace/map');
    expect(call.params.world).toBe('food');
    expect(JSON.parse(call.params.filter)).toMatchObject({ worlds: ['food'], statusFilter: 'open', sortOrder: 'newest' });
  });

  it("lists the world's posts through the main feed query, open and newest first", async () => {
    renderHub();
    expect(await screen.findByTestId('post-p1')).toBeTruthy();
    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({ viewerId: 'viewer-1', limit: 20 }));
    expect(lastFeedFilter()).toMatchObject({ worlds: ['food'], statusFilter: 'open', sortOrder: 'newest' });
  });

  it("opens the main feed's filter sheet with the world locked, and keeps the world on a patch", async () => {
    renderHub();
    await screen.findByTestId('post-p1');
    fireEvent.click(screen.getByTestId('world-feed-filter-button'));
    expect(screen.getByTestId('post-filter-sheet')).toBeTruthy();
    expect(mocks.sheet.last?.lockedWorld).toBe(true);

    patchFilters({ type: 'Request', worlds: ['items'], sortOrder: 'distance' });
    await waitFor(() => expect(lastFeedFilter()).toMatchObject({ type: 'Request', worlds: ['food'], sortOrder: 'distance' }));
    expect(screen.getByTestId('filter-button-badge').textContent).toBe('2');
  });

  it('offers to clear the filters of an empty feed, and clearing restores the whole world', async () => {
    mocks.execute.mockImplementation(async ({ filter }: { filter: { type?: string } }) => ({
      posts: filter.type === 'Request' ? [] : [{ postId: 'p1' }],
      nextCursor: null,
    }));
    renderHub();
    await screen.findByTestId('post-p1');
    patchFilters({ type: 'Request' });
    fireEvent.click(await screen.findByTestId('world-feed-empty-clear'));
    expect(await screen.findByTestId('post-p1')).toBeTruthy();
    expect(screen.queryByTestId('filter-button-badge')).toBeNull();
  });

  it('an empty, unfiltered world invites the first post without a clear action', async () => {
    mocks.execute.mockResolvedValue({ posts: [], nextCursor: null });
    renderHub();
    fireEvent.click(await screen.findByTestId('world-feed-empty-create'));
    expect(mocks.push).toHaveBeenLastCalledWith('/create?category=food');
    expect(screen.queryByTestId('world-feed-empty-clear')).toBeNull();
  });
});
