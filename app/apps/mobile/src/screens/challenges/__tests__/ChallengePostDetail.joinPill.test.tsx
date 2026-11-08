// @vitest-environment jsdom
// #1947: the challenge "Join" pill floats above the docked comment composer instead of covering it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { View } from 'react-native';
import { cleanup, render, within } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';

const challenge = {
  id: 'challenge-1',
  creatorId: 'creator-1',
  status: 'active',
  scope: 'community',
  joined: false,
  measurement: 'yes_no',
};
const post = { postId: 'post-1', ownerId: 'creator-1', status: 'open' };
const auth = { userId: 'viewer-1' as string | null };

vi.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ challengeId: 'challenge-1' }),
  useRouter: () => ({ back: vi.fn() }),
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
  useQuery: ({ queryKey }: { queryKey: unknown[] }) =>
    queryKey[1] === 'detail' ? { data: challenge, isLoading: false } : { data: undefined, isLoading: false },
  useMutation: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('../../../store/authStore', () => ({
  useAuthStore: (select: (s: unknown) => unknown) =>
    select({ session: auth.userId ? { userId: auth.userId } : null }),
}));
vi.mock('../../../hooks/useChallengeLinkedPost', () => ({
  useChallengeLinkedPost: () => ({ post, isLoading: false }),
}));
vi.mock('../../../services/challengeComposition', () => ({ CHALLENGES_QUERY_KEY: 'challenges', challengeUseCases: {} }));
vi.mock('../../../services/platformConfirm', () => ({ confirmAction: vi.fn() }));
vi.mock('../../../lib/challenges/promptChallengeJoinProfileSurface', () => ({
  promptChallengeJoinProfileSurface: vi.fn(),
}));
vi.mock('../../../lib/platform/useKeyboardVerticalOffset', () => ({ useKeyboardVerticalOffset: () => 0 }));
vi.mock('../../../navigation/useShellTabBarVisibility', () => ({
  useShellTabBarVisibility: () => true,
  shellTabBarHeightPx: () => 60,
  useShellTabBarScrollInset: () => 76,
}));
vi.mock('../../../navigation/nativeHeaderIconOnly', () => ({ nativeStackHeaderRightIconOnly: () => ({}) }));
vi.mock('../../../components/post/PostMenuButton', () => ({ PostMenuButton: () => null }));
vi.mock('../../../components/post/PostShareButton', () => ({ PostShareButton: () => null }));
vi.mock('../../../components/post-detail/PostEngagementContext', () => ({
  PostEngagementProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../../components/post-detail/PostEngagementComposer', () => ({
  PostEngagementComposer: () => <View testID="comment-composer" />,
}));
vi.mock('../../../components/EmptyState', () => ({ EmptyState: () => null }));
vi.mock('../ChallengePostDetailView', () => ({ ChallengePostDetailView: () => null }));
vi.mock('../ChallengePostDetailPanels', () => ({ ChallengePostDetailPanels: () => null }));

import ChallengePostDetail from '../ChallengePostDetail';

afterEach(() => {
  cleanup();
  auth.userId = 'viewer-1';
});

function renderScreen() {
  return render(
    <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
      <ChallengePostDetail />
    </ThemeProvider>,
  );
}

function hasAbsoluteAncestor(node: HTMLElement | null): boolean {
  for (let el = node; el; el = el.parentElement) {
    if (getComputedStyle(el).position === 'absolute') return true;
  }
  return false;
}

describe('ChallengePostDetail join pill vs comment composer (#1947)', () => {
  it('docks the join pill in the bottom chrome, above the comment composer', () => {
    const { getByTestId } = renderScreen();
    const chrome = getByTestId('post-detail-bottom-chrome');
    const pill = within(chrome).getByTestId('challenge-join-floating');
    const composer = within(chrome).getByTestId('comment-composer');
    expect(pill.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps the docked pill out of absolute positioning so it cannot overlay the composer', () => {
    const { getAllByTestId } = renderScreen();
    const pills = getAllByTestId('challenge-join-floating');
    expect(pills).toHaveLength(1);
    expect(hasAbsoluteAncestor(pills[0])).toBe(false);
  });

  it('falls back to the floating pill when there is no composer (signed out)', () => {
    auth.userId = null;
    const { getAllByTestId, queryByTestId } = renderScreen();
    expect(queryByTestId('comment-composer')).toBeNull();
    const pills = getAllByTestId('challenge-join-floating');
    expect(pills).toHaveLength(1);
    expect(hasAbsoluteAncestor(pills[0])).toBe(true);
  });
});
