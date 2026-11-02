// Guest preview feed — FR-AUTH-014 (screen 1.7) — wired to live IPostRepository (P0.4-FE).
import React, { useMemo, useState } from 'react';
import { View, TouchableOpacity, Platform, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { selectGuestPreviewPosts } from '@kc/application';
import { spacing, useTheme, Text, iconSize } from '@kc/ui';
import { kcGridCell } from '../../src/components/cards/KcCard.styles';
import { PostCardGrid } from '../../src/components/PostCardGrid';
import { GuestJoinModal } from '../../src/components/GuestJoinModal';
import { FeedCommunityCounter } from '../../src/components/FeedCommunityCounter';
import { useAuthStore } from '../../src/store/authStore';
import { getFeedUseCase } from '../../src/services/postsComposition';
import { useActivePostsCount } from '../../src/hooks/useActivePostsCount';
import { useGuestFeedStyles } from '../../src/screens/guest/feed.styles';
import { KcFlashList } from '../../src/components/lists/KcFlashList';

export { RouteErrorBoundary as ErrorBoundary } from '../../src/components/RouteErrorBoundary';

export default function GuestPreviewFeedScreen() {
  const styles = useGuestFeedStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const setGuest = useAuthStore((s) => s.setGuest);
  const [modalVisible, setModalVisible] = useState(false);
  const activeCount = useActivePostsCount();
  const modalMessage =
    typeof activeCount === 'number'
      ? t('feed.guestBannerWithCount', { count: activeCount })
      : t('feed.guestBanner');

  // limit=6 leaves a small buffer in case the feed includes non-public/closed posts
  // that `selectGuestPreviewPosts` filters out; the selector caps display at 3 (FR-AUTH-014 AC1).
  const query = useQuery({
    queryKey: ['guest-feed'],
    queryFn: () => getFeedUseCase().execute({ viewerId: null, filter: {}, limit: 6 }),
    staleTime: 60_000, // PERF-3: feed — realtime fills gaps; tight stale ensures focus-back refresh
  });
  const posts = useMemo(
    () => selectGuestPreviewPosts(query.data?.posts ?? []),
    [query.data?.posts],
  );

  const goAuth = () => {
    setGuest(false);
    setModalVisible(false);
    router.replace('/(auth)');
  };

  const goWelcome = () => {
    setGuest(false);
    router.replace('/(auth)');
  };

  const openGate = () => setModalVisible(true);

  const renderBody = () => {
    if (query.isLoading && !query.data) {
      return (
        <View style={styles.centerWrap}>
          <ActivityIndicator color={colors.primary} />
        </View>
      );
    }
    if (query.isError && !query.data) {
      return (
        <View style={styles.centerWrap}>
          <Text style={styles.errorTitle}>{t('general.error')}</Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => query.refetch()}
            accessibilityRole="button"
            accessibilityLabel={t('general.retry')}
          >
            <Text style={styles.retryText}>{t('general.retry')}</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <KcFlashList
        data={posts}
        keyExtractor={(item) => item.postId}
        numColumns={2}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={() => query.refetch()}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={
          <Text style={styles.empty}>{t('feed.noResults')}</Text>
        }
        renderItem={({ item }) => (
          <View style={kcGridCell}><PostCardGrid post={item} onPressOverride={openGate} /></View>
        )}
      />
    );
  };

  return (
    <SafeAreaView testID="guest-feed-screen" style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={goWelcome}
          accessibilityRole="button"
          accessibilityLabel={t('auth.guestPreviewBackA11y')}
        >
          <Ionicons
            name={Platform.OS === 'ios' ? 'chevron-forward' : 'arrow-forward'}
            size={iconSize['2xl']}
            color={colors.primary}
          />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('feed.title')}</Text>
        <View style={styles.headerSpacer} />
      </View>

      {renderBody()}

      <View style={[styles.bottomBar, { paddingBottom: spacing.lg + insets.bottom }]}>
        <FeedCommunityCounter
          template={(n) => t('feed.guestBannerWithCount', { count: n })}
          style={styles.bottomHint}
        />
        <TouchableOpacity
          style={styles.bottomCta}
          onPress={goAuth}
          activeOpacity={0.9}
          accessibilityRole="button"
          accessibilityLabel={t('feed.joinNow')}
        >
          <Text style={styles.bottomCtaText}>{t('feed.joinNow')}</Text>
        </TouchableOpacity>
      </View>

      <GuestJoinModal
        visible={modalVisible}
        message={modalMessage}
        joinLabel={t('feed.joinNow')}
        onJoin={goAuth}
        onDismiss={() => setModalVisible(false)}
      />
    </SafeAreaView>
  );
}
