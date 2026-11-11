import React, { useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { ORG_EVENT_KIND_SLUG, type MarketplaceListingDetail } from '@kc/domain';
import { useSimilarListings } from '../../hooks/useMarketplaceListingDetail';
import { ReportListingModal } from './ReportListingModal';
import { GivingHandoffActions } from './GivingHandoffActions';
import { RideBookingActions } from './rides/RideBookingActions';
import { KnowledgeBookingActions } from './knowledge/KnowledgeBookingActions';
import { HousingStayActions } from './housing/HousingStayActions';
import { EventDetailsCard } from './events/EventDetailsCard';
import { EventRegistrationActions } from './events/EventRegistrationActions';
import { RideRouteCard } from './RideRouteCard';
import { RidePublishAgainButton } from './RidePublishAgainButton';
import { RideSeriesManageLink } from './RideSeriesManageLink';
import { RideSeriesOccurrences } from './RideSeriesOccurrences';
import { isTestListingTitle } from '../../lib/displayTitle';
import { PostDetailHeader } from '../cards/PostDetailHeader';
import { SimilarListingCard } from '../cards/SimilarListingCard';
import { useAuthStore } from '../../store/authStore';
import { ListingDetailActions } from './ListingDetailActions';
import { rtlTextAlignStart, rowDirectionStart } from '../../lib/rtlLayout';
import { PublisherCard } from '../post-detail/PublisherCard';
import { DetailHeroCard } from '../post-detail/DetailHeroCard';
import { usePostDetailStyles } from '../../screens/post/postDetailScreen.styles';
import { ListingMediaGallery } from './ListingMediaGallery';
import { useCityName } from '../../hooks/useCityName';
import { useRideHouseNumbers } from '../../hooks/useRideHouseNumbers';

const useStyles = makeUseStyles(({ colors }) => ({
  // Flow actions (reserve / claim / book / message) sit below the content card, like the post page's CTA.
  actions: {
    marginHorizontal: spacing.base,
    marginTop: spacing.sm,
    gap: spacing.sm,
    alignSelf: 'stretch',
  },
  summary: { ...typography.body, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  section: {
    ...typography.h3,
    color: colors.textPrimary,
    marginHorizontal: spacing.base,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    textAlign: rtlTextAlignStart,
    alignSelf: 'stretch',
  },
  similarRow: { paddingHorizontal: spacing.base, flexDirection: rowDirectionStart },
  similarCell: { marginEnd: spacing.sm, paddingVertical: spacing.xs },
}));

interface Props {
  detail: MarketplaceListingDetail;
  bottomInset: number;
  /** Rendered under the actions, before the similar listings (the post's likes and comments). */
  footer?: ReactNode;
  /** Share, report and block live in the post-detail header; omit them from the action row. */
  moderationInHeader?: boolean;
}

/** Placeholder icon for listings without photos; rides get a car like their cards. */
function fallbackIconFor(detail: MarketplaceListingDetail) {
  if (detail.worldSlug === 'rides') return 'car-outline' as const;
  return detail.direction === 'give' ? ('gift-outline' as const) : ('search-outline' as const);
}

export function MarketplaceListingDetailView({ detail, bottomInset, footer, moderationInHeader = false }: Props) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const styles = useStyles();
  const detailStyles = usePostDetailStyles();
  const [reportOpen, setReportOpen] = useState(false);
  const viewerId = useAuthStore((s) => s.session?.userId ?? null);
  const { data: similarRaw = [] } = useSimilarListings(detail.listingId);
  // Never show automated-test listings ([e2e] / raw ISO timestamp titles) to real users.
  const similar = similarRaw.filter((item) => !isTestListingTitle(item.title));

  const worldLabel = i18n.language.startsWith('he') ? detail.worldLabelHe : detail.worldLabelEn;
  const kindLabel = i18n.language.startsWith('he') ? detail.kindLabelHe : detail.kindLabelEn;
  const ownerCityName = useCityName(detail.owner?.cityId ?? null);
  const rideHouseNumbers = useRideHouseNumbers(detail.listingId, detail.worldSlug === 'rides');

  return (
    <>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: bottomInset + spacing.lg }}>
        <DetailHeroCard>
          <ListingMediaGallery media={detail.media} fallbackIcon={fallbackIconFor(detail)} />
        </DetailHeroCard>
        <View style={detailStyles.content}>
          <PostDetailHeader
            title={detail.title}
            tone={detail.direction === 'request' ? 'request' : 'give'}
            badgeLabel={detail.direction === 'request' ? t('feed.requestTypeShort') : t('feed.giveTypeShort')}
            chip={worldLabel}
          />
          {detail.worldSlug === 'rides' ? (
            <RideRouteCard
              embedded
              details={detail.details}
              direction={detail.direction}
              houseNumbers={rideHouseNumbers}
            />
          ) : null}
          {detail.worldSlug === 'rides' ? <RideSeriesOccurrences listingId={detail.listingId} details={detail.details} /> : null}
          {detail.worldSlug === 'rides' && viewerId === detail.ownerId ? <RidePublishAgainButton details={detail.details} /> : null}
          {detail.worldSlug === 'rides' && viewerId === detail.ownerId ? <RideSeriesManageLink details={detail.details} /> : null}
          {/* An organization's event: its window, address, capacity and registration policy (G1 step 5). */}
          {detail.kindSlug === ORG_EVENT_KIND_SLUG ? <EventDetailsCard details={detail.details} /> : null}
          {detail.summary ? <Text style={detailStyles.description}>{detail.summary}</Text> : null}
          <Text style={styles.summary}>{kindLabel}</Text>
          {detail.owner ? (
            <PublisherCard
              name={detail.owner.displayName ?? t('marketplace.anonymousOwner')}
              avatarUrl={detail.owner.avatarUrl}
              cityName={ownerCityName}
              profileRef={detail.owner.shareHandle || detail.owner.userId}
              verificationLevel={detail.owner.verificationLevel}
            />
          ) : null}
        </View>
        <View style={styles.actions}>
          <GivingHandoffActions detail={detail} />
          <RideBookingActions detail={detail} hideOwnerAssign={moderationInHeader} />
          <KnowledgeBookingActions detail={detail} />
          <HousingStayActions detail={detail} hideOwnerAssign={moderationInHeader} />
          <EventRegistrationActions detail={detail} />
          <ListingDetailActions
            detail={detail}
            viewerId={viewerId}
            onReport={() => setReportOpen(true)}
            moderationInHeader={moderationInHeader}
          />
        </View>
        {footer}
        {similar.length > 0 ? (
          <>
            <Text style={styles.section}>{t('marketplace.similarTitle')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.similarRow}>
              {similar.map((item) => (
                <View key={item.listingId} style={styles.similarCell}>
                  <SimilarListingCard
                    item={item}
                    onPress={() => router.push(`/listing/${item.listingId}`)}
                  />
                </View>
              ))}
            </ScrollView>
          </>
        ) : null}
      </ScrollView>
      {!moderationInHeader ? (
        <ReportListingModal listingId={detail.listingId} visible={reportOpen} onClose={() => setReportOpen(false)} />
      ) : null}
    </>
  );
}
