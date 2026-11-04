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

const ProfileListingItem = React.memo(function ProfileListingItem({
  item,
  width,
  onPress,
}: {
  item: ProfileListingRow;
  width: number;
  onPress: (listingId: string) => void;
}) {
  const handlePress = React.useCallback(() => {
    onPress(item.listingId);
  }, [item.listingId, onPress]);

  return <SimilarListingCard item={item} width={width} onPress={handlePress} />;
});

function ProfileMarketplaceListingsInner({ ownerId }: { readonly ownerId: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const styles = useStyles();
  const cardWidth = usePostGridCardWidth(2);
  const { data: listings = [], isLoading } = useProfileMarketplaceListings(ownerId);

  const handlePressListing = React.useCallback(
    (listingId: string) => {
      router.push(`/listing/${listingId}`);
    },
    [router],
  );

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
            <ProfileListingItem
              key={item.listingId}
              item={item}
              width={cardWidth}
              onPress={handlePressListing}
            />
          ))}
        </View>
      )}
    </View>
  );
}

export const ProfileMarketplaceListings = React.memo(ProfileMarketplaceListingsInner);
