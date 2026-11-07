import React, { type ReactNode } from 'react';
import { ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { spacing, Text } from '@kc/ui';
import { Screen } from '../../components/ui/Screen';
import { EmptyState } from '../../components/EmptyState';
import { PrimaryButton } from '../../components/ui/Buttons';
import { MarketplaceListingDetailView } from '../../components/marketplace/MarketplaceListingDetailView';
import { useMarketplaceListingDetail } from '../../hooks/useMarketplaceListingDetail';

type Props = {
  readonly listingId: string | undefined;
  readonly bottomInset?: number;
  /** Rendered under the listing's actions; the post detail passes the post's likes and comments. */
  readonly footer?: ReactNode;
  readonly moderationInHeader?: boolean;
};

export function MarketplaceListingDetailScreen({ listingId, bottomInset = 0, footer, moderationInHeader }: Props) {
  const { t } = useTranslation();
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
    <Screen testID="post-detail-screen">
      <MarketplaceListingDetailView
        detail={detail}
        bottomInset={bottomInset}
        footer={footer}
        moderationInHeader={moderationInHeader}
      />
    </Screen>
  );
}
