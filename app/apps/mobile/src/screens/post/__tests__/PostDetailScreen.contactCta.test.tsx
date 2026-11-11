// @vitest-environment jsdom
// #1946 (FR-POST-015 AC6): the "Send Message to Poster" pill floats above the docked comment
// composer instead of covering it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { View } from 'react-native';
import { cleanup, render, within } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';

const post = {
  postId: 'post-1',
  ownerId: 'owner-1',
  type: 'Give',
  status: 'open',
  listingId: null,
  challengeId: null,
  locationDisplayLevel: 'CityOnly',
  address: { cityName: 'Lod', street: '', streetNumber: '' },
  createdAt: '2026-11-01T10:00:00.000Z',
};

vi.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: 'post-1' }),
  useRouter: () => ({ replace: vi.fn(), back: vi.fn(), canGoBack: () => true }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'he' } }) }));
vi.mock('@expo/vector-icons', async () => (await import('../../../components/ui/__tests__/kitDialogTestKit')).iconsDouble);
vi.mock('react-native-reanimated', async () => (await import('../../../components/ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('react-native-safe-area-context', async () => ({
  ...(await import('../../../components/ui/__tests__/kitDialogTestKit')).safeAreaDouble,
  SafeAreaView: ({ children, testID }: { children: React.ReactNode; testID?: string }) => (
    <View testID={testID}>{children}</View>
  ),
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: { post }, isLoading: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('../../../store/authStore', () => ({
  useAuthStore: (select: (s: unknown) => unknown) => select({ session: { userId: 'viewer-1' } }),
}));
vi.mock('../../../store/feedSessionStore', () => ({ useFeedSessionStore: { getState: () => ({}) } }));
vi.mock('../../../services/postsComposition', () => ({ getPostByIdUseCase: vi.fn() }));
vi.mock('../../../lib/contactPoster', () => ({ contactPoster: vi.fn() }));
vi.mock('../../../hooks/useSeededFeedPost', () => ({ useSeededFeedPost: () => null }));
vi.mock('../../../lib/platform/useKeyboardVerticalOffset', () => ({ useKeyboardVerticalOffset: () => 0 }));
vi.mock('../../../navigation/useShellTabBarVisibility', () => ({
  useShellTabBarVisibility: () => true,
  shellTabBarHeightPx: () => 60,
  useShellTabBarScrollInset: () => 76,
}));
vi.mock('../../../navigation/nativeHeaderIconOnly', () => ({ nativeStackHeaderRightIconOnly: () => ({}) }));
vi.mock('../../../components/post/PostMenuButton', () => ({ PostMenuButton: () => null }));
vi.mock('../../../components/post/PostShareButton', () => ({ PostShareButton: () => null }));
vi.mock('../../../components/closure/OwnerActionsBar', () => ({ OwnerActionsBar: () => null }));
vi.mock('../../../components/post-detail/PostEngagementContext', () => ({
  PostEngagementProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../../components/post-detail/PostEngagementComposer', () => ({
  PostEngagementComposer: () => <View testID="comment-composer" />,
}));
vi.mock('../../../components/EmptyState', () => ({ EmptyState: () => null }));
vi.mock('../PostDetailScrollContent', () => ({ PostDetailScrollContent: () => null }));
vi.mock('../ListingPostDetail', () => ({ ListingPostDetail: () => null }));

import { PostDetailScreen } from '../PostDetailScreen';

afterEach(cleanup);

function renderScreen() {
  return render(
    <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
      <PostDetailScreen />
    </ThemeProvider>,
  );
}

describe('PostDetailScreen contact pill vs comment composer (#1946)', () => {
  it('docks the contact pill in the bottom chrome, above the comment composer', () => {
    const { getByTestId } = renderScreen();
    const chrome = getByTestId('post-detail-bottom-chrome');
    const pill = within(chrome).getByLabelText('post.detail.contactA11y');
    const composer = within(chrome).getByTestId('comment-composer');
    expect(pill.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps the pill out of absolute positioning so it cannot overlay the composer', () => {
    const { getByLabelText } = renderScreen();
    let node: HTMLElement | null = getByLabelText('post.detail.contactA11y');
    while (node) {
      expect(getComputedStyle(node).position).not.toBe('absolute');
      node = node.parentElement;
    }
  });
});
