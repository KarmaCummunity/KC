import React, { type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatDistanceToNow } from 'date-fns';
import { he as dateFnsHe } from 'date-fns/locale';
import { useTranslation } from 'react-i18next';
import type { ChallengeSummary } from '@kc/domain';
import type { PostWithOwner } from '@kc/application';
import { iconSize, spacing, Text, useTheme } from '@kc/ui';
import { PostImageCarousel } from '../../components/PostImageCarousel';
import { PostDetailHeader } from '../../components/cards/PostDetailHeader';
import { DetailHeroCard } from '../../components/post-detail/DetailHeroCard';
import { PublisherCard } from '../../components/post-detail/PublisherCard';
import { PostEngagementThread } from '../../components/post-detail/PostEngagementThread';
import { cleanDisplayTitle } from '../../lib/displayTitle';
import { challengeGoalLabel } from '../../lib/challenges/challengeLabels';
import { usePostDetailStyles } from '../post/postDetailScreen.styles';
import { ChallengeDetailStatusBadge } from './ChallengeDetailStatusBadge';
import { postShowsEngagementSection } from '../../lib/postEngagementVisible';

export type ChallengePostDetailViewProps = Readonly<{
  challenge: ChallengeSummary;
  post: PostWithOwner | null;
  viewerId: string | null;
  scrollBottomInset: number;
  panels: ReactNode;
  engagementFooter?: ReactNode;
}>;

/** Scroll body: post-detail chrome (hero, header, publisher) plus challenge panels and optional engagement. */
export function ChallengePostDetailView({
  challenge,
  post,
  viewerId,
  scrollBottomInset,
  panels,
  engagementFooter,
}: ChallengePostDetailViewProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const detailStyles = usePostDetailStyles();
  const active = challenge.status === 'active';
  const goal = challengeGoalLabel(t, challenge);
  const timeAgo = formatDistanceToNow(new Date(challenge.createdAt), { addSuffix: true, locale: dateFnsHe });
  const showEngagement =
    post != null && viewerId != null && postShowsEngagementSection(post.status);

  const metaLine = [
    goal,
    t('challenges.participants', { n: challenge.participantsCount }),
    t(`challenges.cadence.${challenge.cadence}`),
    t(`challenges.measurement.${challenge.measurement}`),
  ]
    .filter(Boolean)
    .join(' · ');

  const attributeChips: string[] = [
    t(`challenges.scope.${challenge.scope}`),
    challenge.difficulty ? t(`challenges.difficulty.${challenge.difficulty}`) : null,
    challenge.topicLabel,
  ].filter((x): x is string => Boolean(x));

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: scrollBottomInset + spacing.lg }}
      testID="challenge-detail-scroll"
    >
      <DetailHeroCard
        closed={!active}
        isGive
        typeLabel={t('challenges.detail.heroType')}
        badge={<ChallengeDetailStatusBadge active={active} />}
      >
        {post && post.mediaAssets.length > 0 ? (
          <PostImageCarousel mediaAssets={post.mediaAssets} fallbackIcon="gift-outline" />
        ) : (
          <PostImageCarousel mediaAssets={[]} fallbackIcon="gift-outline" />
        )}
      </DetailHeroCard>

      <View style={detailStyles.content}>
        <PostDetailHeader
          title={cleanDisplayTitle(challenge.title)}
          tone="give"
          badgeLabel={t('feed.giveTypeShort')}
          chip={t('post.unifiedCreate.categories.challenges')}
          closed={!active}
        />
        <View style={detailStyles.metaChipsRow}>
          {attributeChips.map((label) => (
            <View key={label} style={detailStyles.metaChip}>
              <Ionicons name="ribbon-outline" size={iconSize.xs} color={colors.textSecondary} />
              <Text style={detailStyles.metaChipText}>{label}</Text>
            </View>
          ))}
        </View>
        {challenge.description ? (
          <Text style={detailStyles.description}>{challenge.description}</Text>
        ) : null}
        {active ? (
          <View style={detailStyles.metaChip}>
            <Ionicons name="people-outline" size={iconSize.xs} color={colors.primary} />
            <Text style={detailStyles.metaChipText}>{metaLine}</Text>
          </View>
        ) : (
          <Text style={detailStyles.description}>{metaLine}</Text>
        )}
        <View style={detailStyles.metaSection}>
          <Text style={detailStyles.timeText}>{timeAgo}</Text>
        </View>
        <PublisherCard
          name={challenge.creatorDisplayName}
          avatarUrl={post?.ownerAvatarUrl ?? null}
          cityName={post?.address.cityName ?? null}
          profileRef={post?.ownerProfileNavigableFromPost !== false ? post?.ownerHandle ?? challenge.creatorId : null}
          verificationLevel={post?.ownerVerificationLevel}
        />
      </View>

      {panels}
      {showEngagement ? engagementFooter ?? <PostEngagementThread /> : null}
    </ScrollView>
  );
}
