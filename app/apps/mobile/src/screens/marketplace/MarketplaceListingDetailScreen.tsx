import React from 'react';
import { ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { spacing, Text } from '@kc/ui';
import { Screen } from '../../components/ui/Screen';
import { MarketplaceListingDetailView } from '../../components/marketplace/MarketplaceListingDetailView';
import { useMarketplaceListingDetail } from '../../hooks/useMarketplaceListingDetail';

type Props = {
  readonly listingId: string | undefined;
  readonly bottomInset?: number;
};

export function MarketplaceListingDetailScreen({ listingId, bottomInset = 0 }: Props) {
  const { t } = useTranslation();
  const { data: detail, isLoading } = useMarketplaceListingDetail(listingId);

  if (isLoading) {
    return (
      <Screen>
        <ActivityIndicator style={{ marginTop: spacing.xl }} />
      </Screen>
    );
  }

  if (!detail) {
    return (
      <Screen>
        <Text style={{ padding: spacing.lg }}>{t('marketplace.notFound')}</Text>
      </Screen>
    );
  }

  return (
    <Screen testID="post-detail-screen">
      <MarketplaceListingDetailView detail={detail} bottomInset={bottomInset} />
    </Screen>
  );
}
