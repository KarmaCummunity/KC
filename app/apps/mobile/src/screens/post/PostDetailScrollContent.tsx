import React from 'react';
import { AccessibilityInfo, ScrollView, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { iconSize, useTheme, Text } from '@kc/ui';
import type { PostWithOwner } from '@kc/application';
import { PostImageCarousel } from '../../components/PostImageCarousel';
import { DetailHeroCard } from '../../components/post-detail/DetailHeroCard';
import { PostDetailStatusBadge } from '../../components/post-detail/PostDetailStatusBadge';
import { PostDetailNotices } from '../../components/post-detail/PostDetailNotices';
import { PublisherCard } from '../../components/post-detail/PublisherCard';
import { RecipientCallout } from '../../components/post-detail/RecipientCallout';
import { RecipientUnmarkBar } from '../../components/post-detail/RecipientUnmarkBar';
import { TranslatableText } from '../../components/TranslatableText';
import { useReaderLanguage } from '../../hooks/useReaderLanguage';
import { useTranslatedPosts } from '../../hooks/useTranslatedPosts';
import { usePostDetailStyles } from './postDetailScreen.styles';
import { PostEngagementThread } from '../../components/post-detail/PostEngagementThread';
import { PostDetailHeader } from '../../components/cards/PostDetailHeader';
import { PostItemReservation } from '../../components/post-detail/PostItemReservation';
import { cleanDisplayTitle } from '../../lib/displayTitle';
import { postShowsEngagementSection } from '../../lib/postEngagementVisible';
import { provenanceLabelKey } from '../../lib/importProvenance';
import { worldClosedStatusKey, worldPlaceholderIcon } from '../../lib/worldDetailCopy';

export type PostDetailScrollContentProps = Readonly<{
  post: PostWithOwner;
  isGive: boolean;
  viewerId: string | null;
  ownerNavigable: boolean;
  ownerLabel: string;
  locationText: string;
  timeAgo: string;
  scrollBottomInset: number;
}>;

export function PostDetailScrollContent({
  post,
  isGive,
  viewerId,
  ownerNavigable,
  ownerLabel,
  locationText,
  timeAgo,
  scrollBottomInset,
}: PostDetailScrollContentProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = usePostDetailStyles();
  const isClosed = post.status === 'closed_delivered';
  // FR-IMPORT-007 AC3: an imported post says where it came from.
  const provenanceKey = provenanceLabelKey(post.importedFrom);
  const isOpen = post.status === 'open';

  const readerLanguage = useReaderLanguage();
  const translations = useTranslatedPosts([post], readerLanguage);
  const [showOriginal, setShowOriginal] = React.useState(false);
  const fields = translations.getTranslatedFields(post.postId);
  const titleStatus = translations.getStatus(post.postId, 'title');
  const descriptionStatus = translations.getStatus(post.postId, 'description');
  const hasAnyTranslation = !!fields.title || !!fields.description;
  const hasDescription = post.description != null && post.description !== '';

  const onToggleOriginal = React.useCallback(() => {
    setShowOriginal((v) => !v);
    AccessibilityInfo.announceForAccessibility(
      !showOriginal ? t('post.showOriginal') : t('post.showTranslation'),
    );
  }, [showOriginal, t]);

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={scrollBottomInset > 0 ? { paddingBottom: scrollBottomInset } : undefined}
    >
      <DetailHeroCard
        closed={isClosed}
        isGive={isGive}
        typeLabel={isGive ? t('post.detail.typeGiveLabel') : t('post.detail.typeRequestLabel')}
        badge={<PostDetailStatusBadge status={post.status} closedLabelKey={worldClosedStatusKey(post.listingWorldSlug)} />}
      >
        <PostImageCarousel
          mediaAssets={post.mediaAssets}
          fallbackIcon={worldPlaceholderIcon(post.listingWorldSlug, post.type)}
        />
      </DetailHeroCard>

      <View style={[styles.content, isClosed ? styles.contentClosed : null]}>
          <PostDetailHeader
            tone={isGive ? 'give' : 'request'}
            badgeLabel={isGive ? t('post.detail.typeGiveLabel') : t('post.detail.typeRequestLabel')}
            chip={t(`post.category.${post.category}`)}
            provenance={provenanceKey ? t(provenanceKey) : null}
            closed={isClosed}
            titleNode={
              <TranslatableText
                source={cleanDisplayTitle(post.title)}
                translated={fields.title}
                status={showOriginal ? 'source' : titleStatus}
                style={styles.title}
              />
            }
          />
          {hasAnyTranslation ? (
            <View style={styles.translationBar}>
              <Text style={styles.autoTranslatedLabel}>{t('post.autoTranslated')}</Text>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={
                  showOriginal ? t('post.showTranslation') : t('post.showOriginal')
                }
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                onPress={onToggleOriginal}
              >
                <Text style={styles.showOriginalLink}>
                  {showOriginal ? t('post.showTranslation') : t('post.showOriginal')}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <PostDetailNotices post={post} />

          <MetaChips post={post} isGive={isGive} />

          {isClosed ? <ClosedDeliveredExtras post={post} viewerId={viewerId} /> : null}

          {hasDescription ? (
            <TranslatableText
              source={post.description as string}
              translated={fields.description}
              status={showOriginal ? 'source' : descriptionStatus}
              style={styles.description}
            />
          ) : null}

          <View style={styles.sectionDivider} />

          {isOpen ? (
            <View style={styles.metaChip}>
              <Ionicons name="sparkles-outline" size={iconSize.xs} color={colors.primary} />
              <Text style={styles.metaChipText}>{t('post.detail.statusOpenHint')}</Text>
            </View>
          ) : null}

          <View style={styles.metaSection}>
            <View style={styles.locationRow}>
              <View style={styles.locationIcon}>
                <Ionicons name="location-outline" size={iconSize.sm} color={colors.primary} />
              </View>
              <Text style={styles.locationText}>{locationText}</Text>
            </View>
            <Text style={styles.timeText}>{timeAgo}</Text>
          </View>

          {/* Same publisher card as listing pages (#1809); lg chevron + no name clamp match prior post-page look. */}
          <PublisherCard
            name={ownerLabel}
            avatarUrl={post.ownerAvatarUrl}
            cityName={post.address.cityName}
            profileRef={ownerNavigable ? post.ownerHandle : null}
            verificationLevel={post.ownerVerificationLevel}
            chevronSize={iconSize.lg}
            nameNumberOfLines={null}
            testID="post-publisher-card"
          />

          <PostItemReservation post={post} />

          {postShowsEngagementSection(post.status) && viewerId ? <PostEngagementThread /> : null}
        </View>
    </ScrollView>
  );
}

function MetaChips(props: Readonly<{ post: PostWithOwner; isGive: boolean }>) {
  const { post, isGive } = props;
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = usePostDetailStyles();

  const chips: React.ReactNode[] = [];
  if (isGive && post.itemCondition != null) {
    chips.push(
      <View key="condition" style={styles.metaChip}>
        <Ionicons name="cube-outline" size={iconSize.xs} color={colors.textSecondary} />
        <Text style={styles.metaChipText}>{t(`post.condition.${post.itemCondition}`)}</Text>
      </View>,
    );
  }
  if (!isGive && post.urgency != null && post.urgency !== '') {
    chips.push(
      <View key="urgency" style={styles.metaChip}>
        <Ionicons name="flash-outline" size={iconSize.xs} color={colors.warning} />
        <Text style={styles.metaChipText}>{post.urgency}</Text>
      </View>,
    );
  }
  if (isGive && post.estimatedValue != null && post.estimatedValue > 0) {
    chips.push(
      <View key="value" style={styles.metaChip}>
        <Ionicons name="pricetag-outline" size={iconSize.xs} color={colors.textSecondary} />
        <Text style={styles.metaChipText}>
          {t('post.estimatedValueBadge', { value: post.estimatedValue })}
        </Text>
      </View>,
    );
  }
  if (chips.length === 0) return null;
  return <View style={styles.metaChipsRow}>{chips}</View>;
}

function ClosedDeliveredExtras(
  props: Readonly<{
    post: PostWithOwner;
    viewerId: string | null;
  }>,
) {
  const { post, viewerId } = props;
  return (
    <>
      {post.recipientUser != null ? (
        <RecipientCallout
          postType={post.type}
          recipient={post.recipientUser}
          profileNavigable={(post.recipientProfileNavigableFromPost ?? true) === true}
        />
      ) : null}
      {post.recipient?.recipientUserId === viewerId && viewerId != null ? (
        <RecipientUnmarkBar postId={post.postId} userId={viewerId} />
      ) : null}
    </>
  );
}
