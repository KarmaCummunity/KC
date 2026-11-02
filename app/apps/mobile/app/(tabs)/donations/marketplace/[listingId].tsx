import React from 'react';
import { ActivityIndicator } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { spacing, Text } from '@kc/ui';
import { Screen } from '../../../../src/components/ui/Screen';
import { EmptyState } from '../../../../src/components/EmptyState';
import { PrimaryButton } from '../../../../src/components/ui/Buttons';
import { useMarketplaceListingDetail } from '../../../../src/hooks/useMarketplaceListingDetail';
import { MarketplaceListingDetailView } from '../../../../src/components/marketplace/MarketplaceListingDetailView';
import { useShellTabBarScrollInset } from '../../../../src/navigation/useShellTabBarVisibility';

export { RouteErrorBoundary as ErrorBoundary } from '../../../../src/components/RouteErrorBoundary';

export default function MarketplaceListingDetailScreen() {
  const { listingId } = useLocalSearchParams<{ listingId: string }>();
  const { t } = useTranslation();
  const inset = useShellTabBarScrollInset();
  const { data: detail, isLoading, isError, refetch } = useMarketplaceListingDetail(listingId);

  if (isLoading) {
    return (
      <Screen>
        <ActivityIndicator style={{ marginTop: spacing.xl }} />
      </Screen>
    );
  }

  if (isError) {
    return (
      <Screen>
        <EmptyState
          icon="cloud-offline-outline"
          title={t('general.errorTitle')}
          subtitle={t('errorBoundary.body')}
          action={
            <PrimaryButton
              testID="listing-detail-retry"
              label={t('general.retry')}
              size="md"
              onPress={() => void refetch()}
            />
          }
        />
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
