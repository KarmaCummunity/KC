import React from 'react';
import { ActivityIndicator } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { spacing, Text } from '@kc/ui';
import { Screen } from '../../../../src/components/ui/Screen';
import { useMarketplaceListingDetail } from '../../../../src/hooks/useMarketplaceListingDetail';
import { MarketplaceListingDetailView } from '../../../../src/components/marketplace/MarketplaceListingDetailView';
import { useShellTabBarScrollInset } from '../../../../src/navigation/useShellTabBarVisibility';

export { RouteErrorBoundary as ErrorBoundary } from '../../../../src/components/RouteErrorBoundary';

export default function MarketplaceListingDetailScreen() {
  const { listingId } = useLocalSearchParams<{ listingId: string }>();
  const { t } = useTranslation();
  const inset = useShellTabBarScrollInset();
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
    <Screen>
      <MarketplaceListingDetailView detail={detail} bottomInset={inset} />
    </Screen>
  );
}
