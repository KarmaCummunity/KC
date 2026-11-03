// Mapped to spec: FR-DONATE-007 / FR-FEED-020 AC2 — a giving world's community links list
// ("nonprofits and links"), rendered under the world's feed rather than above it.
import React from 'react';
import { View } from 'react-native';
import type { DonationCategorySlug } from '@kc/domain';
import { makeUseStyles, spacing } from '@kc/ui';
import { DonationLinksList } from '../DonationLinksList';

const useStyles = makeUseStyles(() => ({
  section: { marginTop: spacing.lg, paddingHorizontal: spacing.lg },
}));

export function WorldLinksSection({ categorySlug }: Readonly<{ categorySlug: DonationCategorySlug }>) {
  const styles = useStyles();
  return (
    <View style={styles.section} testID="world-links-section">
      <DonationLinksList categorySlug={categorySlug} />
    </View>
  );
}
