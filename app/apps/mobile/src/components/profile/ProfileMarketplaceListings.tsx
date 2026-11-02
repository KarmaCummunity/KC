import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import type { ProfileListingRow } from '@kc/domain';
import { useProfileMarketplaceListings } from '../../hooks/useMyMarketplaceListings';
import { usePostGridCardWidth } from '../../hooks/useShellContentWidth';
import { SimilarListingCard } from '../cards/SimilarListingCard';

const useStyles = makeUseStyles(({ colors }) => ({
  section: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.sm },
  title: { ...typography.h3, color: colors.textPrimary },
  grid: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
  empty: { ...typography.body, color: colors.textSecondary },
}));

export function ProfileMarketplaceListings({ ownerId }: { readonly ownerId: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const styles = useStyles();
  const cardWidth = usePostGridCardWidth(2);
  const { data: listings = [], isLoading } = useProfileMarketplaceListings(ownerId);

  return (
    <View style={styles.section}>
      <Text style={styles.title}>{t('marketplace.profileListingsTitle')}</Text>
      {isLoading ? (
        <Text style={styles.empty}>{t('marketplace.loading')}</Text>
      ) : listings.length === 0 ? (
        <Text style={styles.empty}>{t('marketplace.profileListingsEmpty')}</Text>
      ) : (
        <View style={styles.grid}>
          {listings.map((item: ProfileListingRow) => (
            <SimilarListingCard
              key={item.listingId}
              item={item}
              width={cardWidth}
              onPress={() => router.push(`/listing/${item.listingId}`)}
            />
          ))}
        </View>
      )}
    </View>
  );
}
