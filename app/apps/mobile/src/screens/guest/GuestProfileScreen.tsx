// Guest read-only public profile. Missing/private/inactive → neutral unavailable. FR-AUTH-014 AC7.
import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Text, spacing, radius, typography, useTheme } from '@kc/ui';
import type { GuestPost } from '@kc/application';
import {
  getGuestProfile,
  listGuestProfilePosts,
} from '../../services/guestBrowseComposition';
import { GuestAvatar } from '../../components/guest/GuestAvatar';
import { KcCard } from '../../components/cards/KcCard';
import { textAlignStart } from '../../lib/rtlLayout';

export function GuestProfileScreen({ handle }: Readonly<{ handle: string }>) {
  const { colors } = useTheme();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const alignment = textAlignStart();
  const { width } = useWindowDimensions();
  const cityLang = i18n.language.startsWith('en');

  const profile = useQuery({
    queryKey: ['guest-profile', handle],
    queryFn: () => getGuestProfile.execute(handle),
    staleTime: 60_000,
  });

  const posts = useInfiniteQuery({
    queryKey: ['guest-profile-posts', handle],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => listGuestProfilePosts.execute(handle, pageParam),
    getNextPageParam: (page) => (page.length === 20 ? page.at(-1)?.id : undefined),
    enabled: profile.data !== null && profile.data !== undefined,
    staleTime: 30_000,
  });

  const items: readonly GuestPost[] = posts.data?.pages.flat() ?? [];
  const linkStyle = { paddingVertical: spacing.md, paddingHorizontal: spacing.sm };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          gap: spacing.md,
          maxWidth: 680,
          width: '100%',
          alignSelf: 'center',
        }}
      >
        <Pressable
          accessibilityRole="link"
          testID="guest-back"
          onPress={() => router.replace('/browse')}
          style={linkStyle}
        >
          <Text style={{ color: colors.primary }}>{t('auth.guestBack')}</Text>
        </Pressable>

        {profile.isPending ? (
          <ActivityIndicator accessibilityLabel={t('general.loading')} color={colors.primary} />
        ) : null}

        {profile.isError ? (
          <View style={{ gap: spacing.sm }}>
            <Text style={{ color: colors.textPrimary }}>{t('general.error')}</Text>
            <Pressable accessibilityRole="button" onPress={() => { void profile.refetch(); }} style={linkStyle}>
              <Text style={{ color: colors.primary }}>{t('general.retry')}</Text>
            </Pressable>
          </View>
        ) : null}

        {!profile.isPending && !profile.isError && profile.data === null ? (
          <Text testID="guest-profile-unavailable" style={{ color: colors.textSecondary, textAlign: alignment }}>
            {t('auth.guestProfileUnavailable')}
          </Text>
        ) : null}

        {profile.data ? (
          <View testID="guest-profile" style={{ alignItems: 'center', gap: spacing.sm }}>
            <GuestAvatar
              name={profile.data.displayName || profile.data.shareHandle}
              avatarUrl={profile.data.avatarUrl}
            />
            <Text style={{ ...typography.h2, color: colors.textPrimary, textAlign: 'center' }}>
              {profile.data.displayName}
            </Text>
            <Text style={{ ...typography.caption, color: colors.textSecondary }}>
              @{profile.data.shareHandle}
            </Text>
            {(cityLang ? profile.data.cityNameEn : profile.data.cityNameHe) ? (
              <Text style={{ color: colors.textSecondary }}>
                {cityLang ? profile.data.cityNameEn : profile.data.cityNameHe}
              </Text>
            ) : null}
            {profile.data.biography ? (
              <Text style={{ ...typography.body, color: colors.textPrimary, textAlign: alignment }}>
                {profile.data.biography}
              </Text>
            ) : null}
            <Text style={{ color: colors.textSecondary, textAlign: alignment }}>
              {t('auth.guestProfileStats', {
                followers: profile.data.followersCount,
                openPosts: profile.data.openPostsCount,
              })}
            </Text>
          </View>
        ) : null}

        {!posts.isError &&
          items.map((post) => (
            <KcCard
              key={post.id}
              testID={`guest-post-${post.id}`}
              width={Math.min(680, width) - spacing.lg * 2}
              textOnly
              title={post.title}
              summary={post.description}
              location={cityLang ? post.cityNameEn : post.cityNameHe}
              tone="give"
              badgeLabel=""
              placeholderIcon="document-text-outline"
              onPress={() => router.push({ pathname: '/browse/post/[id]', params: { id: post.id } })}
            />
          ))}

        {posts.hasNextPage && !posts.isError ? (
          <Pressable
            accessibilityRole="button"
            disabled={posts.isFetchingNextPage}
            onPress={() => { void posts.fetchNextPage(); }}
            style={linkStyle}
          >
            <Text style={{ color: colors.primary }}>{t('auth.guestMore')}</Text>
          </Pressable>
        ) : null}

        <Pressable
          accessibilityRole="button"
          testID="guest-sign-in"
          onPress={() => router.push('/(auth)')}
          style={{
            ...linkStyle,
            borderRadius: radius.md,
            backgroundColor: colors.primary,
          }}
        >
          <Text style={{ ...typography.button, textAlign: 'center', color: colors.textInverse }}>
            {t('auth.guestSignIn')}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
