import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Text, spacing, radius, typography, useTheme } from '@kc/ui';
import type { GuestPost } from '@kc/application';
import { guestPosts } from '../../services/guestPostsComposition';
import { useRedirectIntentStore } from '../../store/redirectIntentStore';
import { guestMemberIntent } from '../../navigation/guestBrowsePaths';
import { KcCard } from '../../components/cards/KcCard';
import { textAlignStart } from '../../lib/rtlLayout';

/** Read-only guest UI. Shared text-only cards receive no member data or action hooks. */
export function GuestBrowseScreen({ postId }: Readonly<{ postId?: string }>) {
  const { colors } = useTheme();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const alignment = textAlignStart();
  const { width } = useWindowDimensions();
  const detail = useQuery({
    queryKey: ['guest-post', postId], queryFn: () => guestPosts.get(postId ?? ''),
    enabled: postId !== undefined, staleTime: 0, gcTime: 0,
  });
  const feed = useInfiniteQuery({
    queryKey: ['guest-posts'], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => guestPosts.list(pageParam),
    getNextPageParam: (page) => page.length === 20 ? page.at(-1)?.id : undefined,
    enabled: postId === undefined, staleTime: 0, gcTime: 0,
  });
  const state = postId === undefined ? feed : detail;
  const posts: readonly GuestPost[] = postId === undefined
    ? feed.data?.pages.flat() ?? [] : detail.data ? [detail.data] : [];
  const signIn = () => {
    const intent = guestMemberIntent(postId);
    if (intent) useRedirectIntentStore.getState().capturePath(intent);
    router.push('/(auth)');
  };
  const linkStyle = { paddingVertical: spacing.md, paddingHorizontal: spacing.sm };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, maxWidth: 680, width: '100%', alignSelf: 'center' }}>
        {postId !== undefined && (
          <Pressable accessibilityRole="link" testID="guest-back" onPress={() => router.replace('/browse')} style={linkStyle}>
            <Text style={{ color: colors.primary }}>{t('auth.guestBack')}</Text>
          </Pressable>
        )}
        <Text accessibilityRole="header" style={{ ...typography.h2, color: colors.textPrimary, textAlign: alignment }}>
          {t('auth.guestTitle')}
        </Text>
        <Text style={{ ...typography.body, color: colors.textSecondary, textAlign: alignment }}>{t('auth.guestReadOnly')}</Text>
        {postId === undefined ? (
          <Pressable
            accessibilityRole="link"
            testID="guest-map-link"
            onPress={() => router.push('/browse/map')}
            style={linkStyle}
          >
            <Text style={{ color: colors.primary }}>{t('auth.guestMapLink')}</Text>
          </Pressable>
        ) : null}
        {state.isPending && <ActivityIndicator accessibilityLabel={t('general.loading')} color={colors.primary} />}
        {state.isError ? (
          <View style={{ gap: spacing.sm }}>
            <Text style={{ color: colors.textPrimary }}>{t('general.error')}</Text>
            <Pressable accessibilityRole="button" onPress={() => { void state.refetch(); }} style={linkStyle}>
              <Text style={{ color: colors.primary }}>{t('general.retry')}</Text>
            </Pressable>
          </View>
        ) : !state.isPending && posts.length === 0 ? (
          <Text testID="guest-empty" style={{ color: colors.textSecondary, textAlign: alignment }}>
            {t(postId === undefined ? 'auth.guestEmpty' : 'auth.guestUnavailable')}
          </Text>
        ) : null}
        {!state.isError && posts.map((post) => (
          <KcCard
            key={post.id} testID={`guest-post-${post.id}`}
            width={Math.min(680, width) - spacing.lg * 2}
            textOnly disabled={postId !== undefined}
            title={post.title} summary={post.description}
            location={i18n.language.startsWith('en') ? post.cityNameEn : post.cityNameHe}
            tone="give" badgeLabel="" placeholderIcon="document-text-outline"
            onPress={() => router.push({ pathname: '/browse/post/[id]', params: { id: post.id } })}
          />
        ))}
        {postId === undefined && feed.hasNextPage && !feed.isError && (
          <Pressable accessibilityRole="button" disabled={feed.isFetchingNextPage} onPress={() => { void feed.fetchNextPage(); }} style={linkStyle}>
            <Text style={{ color: colors.primary }}>{t('auth.guestMore')}</Text>
          </Pressable>
        )}
        <Pressable accessibilityRole="button" testID="guest-sign-in" onPress={signIn} style={{ ...linkStyle, borderRadius: radius.md, backgroundColor: colors.primary }}>
          <Text style={{ ...typography.button, textAlign: 'center', color: colors.textInverse }}>{t('auth.guestSignIn')}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
