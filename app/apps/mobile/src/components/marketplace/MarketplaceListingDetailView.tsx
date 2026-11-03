import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, radius, spacing, typography, Text } from '@kc/ui';
import type { MarketplaceListingDetail } from '@kc/domain';
import { KCImage } from '../ui/KCImage';
import { listingImagePublicUrl } from '../../services/listingImageUpload';
import { useSimilarListings } from '../../hooks/useMarketplaceListingDetail';
import { ReportListingModal } from './ReportListingModal';
import { GivingHandoffActions } from './GivingHandoffActions';
import { RideBookingActions } from './rides/RideBookingActions';
import { RideRouteCard } from './RideRouteCard';
import { RidePublishAgainButton } from './RidePublishAgainButton';
import { RideSeriesManageLink } from './RideSeriesManageLink';
import { RideSeriesOccurrences } from './RideSeriesOccurrences';
import { isTestListingTitle } from '../../lib/displayTitle';
import { PostDetailHeader } from '../cards/PostDetailHeader';
import { SimilarListingCard } from '../cards/SimilarListingCard';
import { useAuthStore } from '../../store/authStore';
import { ListingDetailActions } from './ListingDetailActions';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { PublisherCard } from '../post-detail/PublisherCard';
import { useCityName } from '../../hooks/useCityName';

const useStyles = makeUseStyles(({ colors }) => ({
  body: { padding: spacing.lg, gap: spacing.md },
  summary: { ...typography.body, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  section: { ...typography.h3, color: colors.textPrimary, marginTop: spacing.md },
  similarCell: { marginEnd: spacing.sm, paddingVertical: spacing.xs },
  galleryImg: { width: 280, height: 180, borderRadius: radius.md, marginEnd: spacing.sm },
}));

interface Props {
  detail: MarketplaceListingDetail;
  bottomInset: number;
}

export function MarketplaceListingDetailView({ detail, bottomInset }: Props) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const styles = useStyles();
  const [reportOpen, setReportOpen] = useState(false);
  const viewerId = useAuthStore((s) => s.session?.userId ?? null);
  const { data: similarRaw = [] } = useSimilarListings(detail.listingId);
  // Never show automated-test listings ([e2e] / raw ISO timestamp titles) to real users.
  const similar = similarRaw.filter((item) => !isTestListingTitle(item.title));

  const worldLabel = i18n.language.startsWith('he') ? detail.worldLabelHe : detail.worldLabelEn;
  const kindLabel = i18n.language.startsWith('he') ? detail.kindLabelHe : detail.kindLabelEn;
  const ownerCityName = useCityName(detail.owner?.cityId ?? null);

  return (
    <>
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: bottomInset }]}>
        {detail.media.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {detail.media.map((item) => (
              <KCImage
                key={item.storagePath}
                uri={listingImagePublicUrl(item.storagePath)}
                style={styles.galleryImg}
              />
            ))}
          </ScrollView>
        ) : null}
        <PostDetailHeader
          title={detail.title}
          tone={detail.direction === 'request' ? 'request' : 'give'}
          badgeLabel={detail.direction === 'request' ? t('feed.requestTypeShort') : t('feed.giveTypeShort')}
          chip={worldLabel}
        />
        {detail.worldSlug === 'rides' ? <RideRouteCard details={detail.details} direction={detail.direction} /> : null}
        {detail.worldSlug === 'rides' ? <RideSeriesOccurrences listingId={detail.listingId} details={detail.details} /> : null}
        {detail.worldSlug === 'rides' && viewerId === detail.ownerId ? <RidePublishAgainButton details={detail.details} /> : null}
        {detail.worldSlug === 'rides' && viewerId === detail.ownerId ? <RideSeriesManageLink details={detail.details} /> : null}
        {detail.summary ? <Text style={styles.summary}>{detail.summary}</Text> : null}
        <Text style={styles.summary}>
          {kindLabel}
        </Text>
        {detail.owner ? (
          <PublisherCard
            name={detail.owner.displayName ?? t('marketplace.anonymousOwner')}
            avatarUrl={detail.owner.avatarUrl}
            cityName={ownerCityName}
            profileRef={detail.owner.shareHandle || detail.owner.userId}
          />
        ) : null}
        <GivingHandoffActions detail={detail} />
        <RideBookingActions detail={detail} />
        <ListingDetailActions detail={detail} viewerId={viewerId} onReport={() => setReportOpen(true)} />
        {similar.length > 0 ? (
          <>
            <Text style={styles.section}>{t('marketplace.similarTitle')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
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
      <ReportListingModal listingId={detail.listingId} visible={reportOpen} onClose={() => setReportOpen(false)} />
    </>
  );
}
