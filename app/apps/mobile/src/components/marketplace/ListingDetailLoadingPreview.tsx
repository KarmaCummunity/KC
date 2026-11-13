// What a listing-world post (rides, food, housing, time, knowledge…) shows while its listing
// detail is still loading: the hero photo, title, world chip and description the feed card already
// carries, laid out like `MarketplaceListingDetailView`, with a small spinner where the world's own
// sections and actions will appear. Opening a post never starts from a blank spinner screen.
import React from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, Text, useTheme } from '@kc/ui';
import type { PostWithOwner } from '@kc/application';
import { DetailHeroCard } from '../post-detail/DetailHeroCard';
import { PostDetailHeader } from '../cards/PostDetailHeader';
import { KCImage } from '../ui/KCImage';
import { usePostDetailStyles } from '../../screens/post/postDetailScreen.styles';
import { getSupabasePublicImageUrl } from '../../lib/imageUrl';
import { feedCardCategory } from '../../lib/feedCardCategory';

/** Same height as the listing gallery frame, so the hero does not jump when the detail arrives. */
const HERO_HEIGHT = 240;
const PLACEHOLDER_ICON_SIZE = 72;

const useStyles = makeUseStyles(({ colors }) => ({
  hero: { height: HERO_HEIGHT, backgroundColor: colors.skeleton, overflow: 'hidden' as const },
  heroEmpty: { justifyContent: 'center' as const, alignItems: 'center' as const },
  heroImage: { width: '100%' as const, height: HERO_HEIGHT },
  pending: { marginTop: spacing.lg },
}));

type Props = Readonly<{
  /** The post as the feed (or the post read) already knows it. */
  post: PostWithOwner;
  bottomInset?: number;
}>;

export function ListingDetailLoadingPreview({ post, bottomInset = 0 }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useStyles();
  const detailStyles = usePostDetailStyles();
  const category = feedCardCategory(post);
  const cover = post.mediaAssets[0];
  const coverUrl = cover ? getSupabasePublicImageUrl({ bucket: cover.bucket, path: cover.path }) : '';
  const isGive = post.type === 'Give';

  return (
    <ScrollView
      testID="listing-detail-loading-preview"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: bottomInset + spacing.lg }}
    >
      <DetailHeroCard>
        {coverUrl ? (
          <View style={styles.hero}>
            <KCImage uri={coverUrl} style={styles.heroImage} contentFit="cover" />
          </View>
        ) : (
          <View style={[styles.hero, styles.heroEmpty]}>
            <Ionicons name={category.icon} size={PLACEHOLDER_ICON_SIZE} color={colors.textSecondary} />
          </View>
        )}
      </DetailHeroCard>
      <View style={detailStyles.content}>
        <PostDetailHeader
          title={post.title}
          tone={isGive ? 'give' : 'request'}
          badgeLabel={isGive ? t('feed.giveTypeShort') : t('feed.requestTypeShort')}
          chip={t(category.chipKey)}
        />
        {post.description ? <Text style={detailStyles.description}>{post.description}</Text> : null}
      </View>
      <ActivityIndicator style={styles.pending} />
    </ScrollView>
  );
}
