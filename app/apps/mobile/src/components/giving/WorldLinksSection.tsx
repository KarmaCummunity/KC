// Mapped to spec: FR-DONATE-007 / FR-FEED-020 AC2 — a giving world's community links list
// ("nonprofits and links"), rendered under the world's feed rather than above it.
// With `collapsible` it starts collapsed behind a titled row (rides hub, #1626),
// so the feed stays the main content.
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { DonationCategorySlug } from '@kc/domain';
import { makeUseStyles, spacing, typography, iconSize, useTheme, Text } from '@kc/ui';
import { DonationLinksList } from '../DonationLinksList';
import { rowDirectionStart } from '../../lib/rtlLayout';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';

const useStyles = makeUseStyles(({ colors }) => ({
  section: { marginTop: spacing.lg, paddingHorizontal: spacing.lg },
  toggle: {
    flexDirection: rowDirectionStart,
    alignItems: 'center' as const,
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  toggleText: { ...typography.h3, color: colors.textPrimary, flex: 1, textAlign: rtlTextAlignStart },
}));

interface Props {
  readonly categorySlug: DonationCategorySlug;
  /** Starts collapsed under a titled row that opens the list. */
  readonly collapsible?: boolean;
}

export function WorldLinksSection({ categorySlug, collapsible = false }: Props) {
  const styles = useStyles();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);

  if (!collapsible) {
    return (
      <View style={styles.section} testID="world-links-section">
        <DonationLinksList categorySlug={categorySlug} />
      </View>
    );
  }

  const title = t('donations.links.sectionTitle');
  return (
    <View style={styles.section} testID="world-links-section">
      <Pressable
        testID="world-links-toggle"
        onPress={() => setOpen((value) => !value)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={title}
        style={styles.toggle}
      >
        <Text style={styles.toggleText}>{title}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={iconSize.md} color={colors.textSecondary} />
      </Pressable>
      {open ? <DonationLinksList categorySlug={categorySlug} showTitle={false} /> : null}
    </View>
  );
}
