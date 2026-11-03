// app/apps/mobile/src/components/PostCardGrid.tsx
import React from 'react';
import { useRouter } from 'expo-router';
import { formatDistanceToNow } from 'date-fns';
import { he as dateFnsHe } from 'date-fns/locale';
import { useTranslation } from 'react-i18next';
import { avatarPalette, spacing } from '@kc/ui';
import type { PostWithOwner } from '@kc/application';
import type { IdentityRoleForViewedProfile } from '@kc/domain';
import { TranslatableText, type TranslatableStatus } from './TranslatableText';
import { PROFILE_GRID_COLUMNS, usePostGridCardWidth } from '../hooks/useShellContentWidth';
import { postOwnerDisplayLabel } from '../lib/postOwnerDisplayLabel';
import { getSupabasePublicImageUrl, getSupabaseFeedImageUrl } from '../lib/imageUrl';
import { PostMenuButton } from './post/PostMenuButton';
import { KcCard } from './cards/KcCard';
import { usePostCardGridStyles } from './PostCardGrid.styles';
import { finishMark } from '../lib/observability/perfMarks';
import { cleanDisplayTitle } from '../lib/displayTitle';
import { feedCardCategory } from '../lib/feedCardCategory';

// The menu sits on the image scrim, which is dark in both themes, so the icon is always white.
const OVERLAY_ICON = avatarPalette.foreground;

interface PostCardGridProps {
  post: PostWithOwner;
  onPressOverride?: () => void;
  /** Per-post press handler — receives the full post so the parent avoids per-item closures. */
  onCardPress?: (post: PostWithOwner) => void;
  /** Grid density — home feed uses 2; profile grids use 3. */
  columns?: 2 | 3;
  gap?: number;
  /** Closed-posts tab: economic-role badge (giver/receiver). */
  identityRole?: IdentityRoleForViewedProfile;
  /** Forwarded to post detail for D-31 identity projection on closed-posts grids. */
  closedPostsProfileUserId?: string;
  /** FR-TRANSLATE-003 — reader-language translated fields (feed viewport-gated). */
  translatedFields?: { title?: string; description?: string };
  /** FR-TRANSLATE-003 — per-field translation status; defaults to 'source'. */
  titleStatus?: TranslatableStatus;
  descriptionStatus?: TranslatableStatus;
}

function PostCardGridInner({
  post,
  onPressOverride,
  onCardPress,
  columns = 2,
  gap = spacing.sm,
  identityRole,
  closedPostsProfileUserId,
  translatedFields,
  titleStatus,
  // descriptionStatus is accepted for the card contract but the grid card
  // renders only the title; description is translated for post-detail reuse.
}: PostCardGridProps) {
  const router = useRouter();
  const { t } = useTranslation();
  const styles = usePostCardGridStyles();
  const cardWidth = usePostGridCardWidth(columns, gap);
  const isProfileGrid = columns === PROFILE_GRID_COLUMNS;
  const isGive = post.type === 'Give';
  // A rides / food / housing / time listing shows its world rather than the "Other" category.
  const cardCategory = feedCardCategory(post);

  const timeAgo = React.useMemo(
    () => formatDistanceToNow(new Date(post.createdAt), { addSuffix: true, locale: dateFnsHe }),
    [post.createdAt],
  );

  const locationText = post.locationDisplayLevel === 'CityOnly'
    ? post.address.cityName
    : `${post.address.cityName}, ${post.address.street}`;

  const firstImage = post.mediaAssets[0] ?? null;
  const firstImagePath = firstImage?.path ?? null;
  // A feed mirror of a listing borrows its photos from the listing-images bucket (D-206).
  const imageBucket = firstImage?.bucket ?? 'post-images';
  // PERF-4: serve the 400px thumb for the grid surface (~25-40KB vs ~300-500KB
  // for the 2048px full). KCImage falls back to the full URL if the thumb is
  // missing (e.g., for posts uploaded before the thumb pipeline shipped — the
  // backfill Edge Function eventually fills these in).
  const thumbUrl = React.useMemo(
    () => firstImagePath
      ? getSupabaseFeedImageUrl(imageBucket, firstImagePath, cardWidth)
      : null,
    [imageBucket, firstImagePath, cardWidth],
  );
  const fullUrl = React.useMemo(
    () => firstImagePath
      ? getSupabasePublicImageUrl({ bucket: imageBucket, path: firstImagePath })
      : null,
    [imageBucket, firstImagePath],
  );

  const ownerLabel = postOwnerDisplayLabel(post, t);
  const economicRole = identityRole ? deriveEconomicRole(post.type, identityRole) : null;

  const onImageLoadOnce = React.useCallback(() => {
    finishMark('image.first_paint');
  }, []);

  const navigateToPost = React.useCallback(() => {
    if (onCardPress) {
      onCardPress(post);
      return;
    }
    if (onPressOverride) {
      onPressOverride();
      return;
    }
    const q =
      closedPostsProfileUserId != null
        ? `?fromProfile=${encodeURIComponent(closedPostsProfileUserId)}`
        : '';
    router.push(`/post/${post.postId}${q}`);
  }, [onCardPress, onPressOverride, post, closedPostsProfileUserId, router]);

  let roleBadgeLabel: string | null = null;
  if (economicRole) roleBadgeLabel = economicRole === 'giver' ? t('feed.giverBadge') : t('feed.receiverBadge');

  return (
    <KcCard
      testID="feed-post-card"
      width={cardWidth}
      dense={isProfileGrid}
      onPress={navigateToPost}
      accessibilityLabel={cleanDisplayTitle(post.title)}
      imageUri={thumbUrl}
      fallbackUri={fullUrl}
      onImageLoad={onImageLoadOnce}
      placeholderIcon={cardCategory.icon}
      tone={isGive ? 'give' : 'request'}
      badgeLabel={isGive ? t('feed.giveTypeShort') : t('feed.requestTypeShort')}
      roleBadgeLabel={roleBadgeLabel}
      menu={<PostMenuButton post={post} iconColor={OVERLAY_ICON} overlaySize={isProfileGrid ? 'compact' : 'default'} />}
      author={{ name: ownerLabel, avatarUrl: post.ownerAvatarUrl }}
      title={
        <TranslatableText
          source={cleanDisplayTitle(post.title)}
          translated={translatedFields?.title}
          status={titleStatus ?? 'source'}
          numberOfLines={2}
          style={[styles.title, isProfileGrid && styles.titleDense]}
          indicatorStyle={styles.translatingIndicator}
        />
      }
      chip={t(cardCategory.chipKey)}
      location={locationText}
      timeAgo={timeAgo}
      closed={post.status !== 'open'}
      closedLabel={t('cards.closed')}
    />
  );
}

export const PostCardGrid = React.memo(PostCardGridInner);

function deriveEconomicRole(
  postType: PostWithOwner['type'],
  identityRole: IdentityRoleForViewedProfile,
): 'giver' | 'receiver' {
  if (identityRole === 'publisher') return postType === 'Give' ? 'giver' : 'receiver';
  return postType === 'Give' ? 'receiver' : 'giver';
}
