// Challenge full post — post-detail shell (hero, publisher, engagement) plus challenge engine UI.
// Mapped to: docs/spec/10_challenges.md, FR-FEED-020.
import React, { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChallengeProgressResult } from '@kc/domain';
import { spacing, useTheme } from '@kc/ui';
import { EmptyState } from '../../components/EmptyState';
import { PostMenuButton } from '../../components/post/PostMenuButton';
import { PostShareButton } from '../../components/post/PostShareButton';
import { PostEngagementProvider } from '../../components/post-detail/PostEngagementContext';
import { PostEngagementComposer } from '../../components/post-detail/PostEngagementComposer';
import { PostDetailBottomChrome } from '../../components/post-detail/PostDetailBottomChrome';
import {
  POST_DETAIL_FLOATING_CTA_RESERVE_PX,
  postDetailScrollBottomInset,
} from '../../components/post-detail/postDetailBottomMetrics';
import { nativeStackHeaderRightIconOnly } from '../../navigation/nativeHeaderIconOnly';
import {
  useShellTabBarVisibility,
  useShellTabBarScrollInset,
  shellTabBarHeightPx,
} from '../../navigation/useShellTabBarVisibility';
import { ownerBarTabClearance } from '../../components/shell/tabBarGeometry';
import { useKeyboardVerticalOffset } from '../../lib/platform/useKeyboardVerticalOffset';
import { postShowsEngagementSection } from '../../lib/postEngagementVisible';
import { useAuthStore } from '../../store/authStore';
import { CHALLENGES_QUERY_KEY, challengeUseCases } from '../../services/challengeComposition';
import { confirmAction } from '../../services/platformConfirm';
import { promptChallengeJoinProfileSurface } from '../../lib/challenges/promptChallengeJoinProfileSurface';
import { useChallengeLinkedPost } from '../../hooks/useChallengeLinkedPost';
import { usePostDetailStyles } from '../post/postDetailScreen.styles';
import { ChallengePostDetailView } from './ChallengePostDetailView';
import { ChallengePostDetailPanels } from './ChallengePostDetailPanels';
import { ChallengeJoinPill } from './ChallengeJoinPill';

function normalizeChallengeId(raw: string | string[] | undefined): string {
  const id = Array.isArray(raw) ? raw[0] : raw;
  return typeof id === 'string' ? id.trim() : '';
}

export default function ChallengePostDetail() {
  const { challengeId: rawChallengeId } = useLocalSearchParams<{ challengeId: string | string[] }>();
  const challengeId = normalizeChallengeId(rawChallengeId);
  const { t } = useTranslation();
  const styles = usePostDetailStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const myUserId = useAuthStore((state) => state.session?.userId ?? null);
  const [lastResult, setLastResult] = useState<ChallengeProgressResult | null>(null);

  const challenge = useQuery({
    queryKey: [CHALLENGES_QUERY_KEY, 'detail', challengeId],
    queryFn: () => challengeUseCases.get().execute(challengeId),
    enabled: Boolean(challengeId),
  });
  const { post, isLoading: postLinkLoading } = useChallengeLinkedPost(
    challengeId || undefined,
    myUserId,
  );

  const joined = challenge.data?.joined ?? false;
  const entries = useQuery({
    queryKey: [CHALLENGES_QUERY_KEY, 'entries', challengeId],
    queryFn: () => challengeUseCases.listEntries().execute(challengeId, 14),
    enabled: joined,
  });
  const leaderboard = useQuery({
    queryKey: [CHALLENGES_QUERY_KEY, 'leaderboard', challengeId],
    queryFn: () => challengeUseCases.listLeaderboard().execute(challengeId),
    enabled: joined && challenge.data?.scope === 'community',
  });

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: [CHALLENGES_QUERY_KEY] }),
      queryClient.invalidateQueries({ queryKey: ['feed'] }),
      queryClient.invalidateQueries({ queryKey: ['challenge', 'postId', challengeId] }),
      queryClient.invalidateQueries({ queryKey: ['my-posts'] }),
      queryClient.invalidateQueries({ queryKey: ['my-hidden-open-posts'] }),
      queryClient.invalidateQueries({ queryKey: ['profile-other-posts'] }),
    ]);

  const report = useMutation({
    mutationFn: (input: { value: number; note: string | null }) =>
      challengeUseCases.report().execute({
        challengeId,
        measurement: challenge.data!.measurement,
        value: input.value,
        note: input.note,
        reportDate: null,
      }),
    onSuccess: async (result) => {
      setLastResult(result);
      await refresh();
    },
  });

  const membership = useMutation({
    mutationFn: (
      input: { action: 'join'; showOnProfile: boolean } | { action: 'leave' | 'end' },
    ) => {
      if (input.action === 'join') {
        return challengeUseCases.join().execute(challengeId, input.showOnProfile);
      }
      return challengeUseCases[input.action]().execute(challengeId);
    },
    onSuccess: async (_data, input) => {
      await refresh();
      if (input.action === 'leave') router.back();
    },
  });

  const requestJoin = async () => {
    const choice = await promptChallengeJoinProfileSurface(
      t('challenges.detail.joinProfileTitle'),
      t('challenges.detail.joinProfileBody'),
      {
        show: t('challenges.detail.joinProfileShow'),
        hide: t('challenges.detail.joinProfileHidden'),
        cancel: t('general.cancel'),
      },
    );
    if (choice === 'cancel') return;
    membership.mutate({ action: 'join', showOnProfile: choice === 'show' });
  };

  const confirmThen = async (action: 'leave' | 'end') => {
    const ok = await confirmAction(t(`challenges.detail.${action}Title`), t(`challenges.detail.${action}Body`), {
      confirmLabel: t(`challenges.detail.${action}`),
      destructive: true,
    });
    if (ok) membership.mutate({ action });
  };

  const showShellTabBar = useShellTabBarVisibility();
  const tabBarPad = shellTabBarHeightPx(showShellTabBar);
  const safeBottom = useSafeAreaInsets().bottom;
  const tabBarDockInset = showShellTabBar ? ownerBarTabClearance(tabBarPad, safeBottom) : 0;
  const ctaBottom = useShellTabBarScrollInset(spacing.base);
  const keyboardOffset = useKeyboardVerticalOffset();

  if (challenge.isLoading || postLinkLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const data = challenge.data;
  if (!data) {
    return (
      <SafeAreaView style={styles.container}>
        <EmptyState
          icon="trophy-outline"
          title={t('challenges.detail.notFound')}
          subtitle={t('challenges.errors.challenge_not_found')}
        />
      </SafeAreaView>
    );
  }

  const isCreator = data.creatorId === myUserId;
  const active = data.status === 'active';
  const showJoinCta = !joined && active;
  const showEngagementComposer =
    Boolean(myUserId) && post != null && postShowsEngagementSection(post.status);
  // With the composer docked, the pill rides in the bottom chrome above it so it never covers the input.
  const dockJoinPill = showJoinCta && showEngagementComposer;
  const floatJoinPill = showJoinCta && !showEngagementComposer;
  const scrollBottomInset = postDetailScrollBottomInset({
    tabBarOverlayInset: tabBarDockInset,
    hasComposer: showEngagementComposer,
    floatingCtaReserve: floatJoinPill ? POST_DETAIL_FLOATING_CTA_RESERVE_PX : 0,
  });
  const joinPill = (
    <ChallengeJoinPill busy={membership.isPending} onPress={() => void requestJoin()} />
  );

  const panels = (
    <ChallengePostDetailPanels
      challenge={data}
      joined={joined}
      isCreator={isCreator}
      entries={entries.data ?? []}
      leaderboard={leaderboard.data}
      membershipError={membership.error}
      membershipPending={membership.isPending}
      reportBusy={report.isPending}
      reportError={report.error}
      lastResult={lastResult}
      onLeave={() => void confirmThen('leave')}
      onEnd={() => void confirmThen('end')}
      onReport={(value, note) => report.mutate({ value, note })}
    />
  );

  const body = (
    <ChallengePostDetailView
      challenge={data}
      post={post}
      viewerId={myUserId}
      scrollBottomInset={scrollBottomInset}
      panels={panels}
    />
  );

  return (
    <SafeAreaView
      style={styles.container}
      edges={showEngagementComposer ? [] : ['bottom']}
      testID="challenge-detail-screen"
    >
      {post ? (
        <Stack.Screen
          options={{
            ...nativeStackHeaderRightIconOnly(() => (
              <View style={styles.headerActions}>
                <PostShareButton post={post} placement="header" />
                <PostMenuButton post={post} placement="header" showShareInMenu={false} />
              </View>
            )),
          }}
        />
      ) : null}
      {post && myUserId ? (
        <PostEngagementProvider postId={post.postId} viewerId={myUserId}>
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={keyboardOffset}
          >
            {body}
            {showEngagementComposer ? (
              <PostDetailBottomChrome
                tabBarOverlayInset={tabBarDockInset}
                floatingSlot={dockJoinPill ? joinPill : undefined}
                composerSlot={<PostEngagementComposer embedded />}
              />
            ) : null}
          </KeyboardAvoidingView>
        </PostEngagementProvider>
      ) : (
        body
      )}

      {floatJoinPill ? (
        <View style={[styles.cta, { bottom: ctaBottom }]} pointerEvents="box-none">
          {joinPill}
        </View>
      ) : null}
    </SafeAreaView>
  );
}
