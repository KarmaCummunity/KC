import React from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { useMarketplaceRecommendations } from '../../hooks/useMarketplaceBrowse';
import { ListingCard } from '../cards/ListingCard';
import { rtlTextAlignStart } from '../../lib/rtlLayout';

const useStyles = makeUseStyles(({ colors }) => ({
  wrap: { paddingVertical: spacing.md, gap: spacing.sm },
  title: { ...typography.h3, color: colors.textPrimary, paddingHorizontal: spacing.lg, textAlign: rtlTextAlignStart },
  scroll: { paddingHorizontal: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xs },
}));

export function MarketplaceForYouSection() {
  const { t } = useTranslation();
  const router = useRouter();
  const styles = useStyles();
  const { data: rows = [] } = useMarketplaceRecommendations(6);

  if (rows.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{t('marketplace.forYouTitle')}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {rows.map((item) => (
          <ListingCard
            key={item.listingId}
            item={item}
            variant="tile"
            onPress={() => router.push(`/listing/${item.listingId}`)}
          />
        ))}
      </ScrollView>
    </View>
  );
}
