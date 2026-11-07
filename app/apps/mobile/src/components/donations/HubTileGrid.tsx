// Donations hub — a section heading plus a 2-column grid of giving-world tiles (D100).
// A world with no active flow yet carries a small "portal" tag (D60).
import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, Text, typography } from '@kc/ui';
import { PressableScale } from '../animations/PressableScale';
import { Card } from '../ui/Card';
import { IconTile } from '../ui/IconTile';
import { Chip } from '../ui/Chip';
import { MotionEntry, ENTRY_DELAY } from '../ui/MotionEntry';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import type { DonationHubTile } from '../../navigation/donationsHubTiles';

/** A hub tile plus whether its world is still a portal (no feed / in-app flow yet). */
export type HubGridTile = DonationHubTile & { readonly portal?: boolean };

function pairs<T>(items: readonly T[]): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2));
  return rows;
}

export function HubTileGrid({
  heading,
  tiles,
  delay,
  onTilePress,
}: Readonly<{ heading: string; tiles: readonly HubGridTile[]; delay: number; onTilePress?: (key: string) => void }>) {
  const styles = useStyles();
  const router = useRouter();
  const { t } = useTranslation();
  return (
    <View style={styles.categoriesSection}>
      <MotionEntry variant="bottom" delay={delay} style={styles.blockStretch}>
        <Text style={styles.gridHeading}>{heading}</Text>
      </MotionEntry>
      <View style={styles.grid}>
        {pairs(tiles).map((pair) => (
          <MotionEntry
            key={pair.map((c) => c.key).join('-')}
            variant="bottom"
            delay={ENTRY_DELAY.buttons}
            style={[styles.gridRowMotion, styles.blockStretch]}
          >
            <View style={styles.row}>
              {pair.map((cat) => (
                <PressableScale
                  key={cat.key}
                  onPress={() => {
                    onTilePress?.(cat.key);
                    router.push(cat.href);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${t(cat.titleKey)} — ${t(cat.subtitleKey)}`}
                  style={styles.gridPressable}
                >
                  <Card padding="md" style={styles.gridCard} testID={cat.testID}>
                    {cat.portal ? (
                      <View style={styles.portalTag}>
                        <Chip variant="tag" size="sm" label={t('donations.worldLaunch.portalBadge')} testID={`${cat.testID}-portal`} />
                      </View>
                    ) : null}
                    <IconTile icon={cat.icon} size="lg" />
                    <Text style={styles.gridTitle} numberOfLines={1}>
                      {t(cat.titleKey)}
                    </Text>
                    <Text style={styles.gridSubtitle} numberOfLines={2}>
                      {t(cat.subtitleKey)}
                    </Text>
                  </Card>
                </PressableScale>
              ))}
              {pair.length === 1 ? <View style={styles.spacer} /> : null}
            </View>
          </MotionEntry>
        ))}
      </View>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  // Grid — section heading then 2-col cards.
  gridHeading: {
    ...typography.h3,
    color: colors.textPrimary,
    textAlign: rtlTextAlignStart,
    width: '100%',
    marginTop: spacing.sm,
    marginBottom: spacing.base,
  },
  // RN-Web + RTL: nested blocks can shrink-wrap to inline-start without explicit stretch.
  blockStretch: { width: '100%', alignSelf: 'stretch' as const },

  // Fills leftover viewport below hero + featured so category rows share height.
  categoriesSection: { flex: 1, width: '100%', alignSelf: 'stretch' as const },
  grid: { flex: 1, gap: spacing.base, width: '100%', alignSelf: 'stretch' as const },
  gridRowMotion: { flex: 1, minHeight: 0 },
  row: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'stretch' as const,
    gap: spacing.base,
    minHeight: 112,
    width: '100%',
    alignSelf: 'stretch' as const,
  },
  gridPressable: { flex: 1, alignSelf: 'stretch' as const },
  gridCard: {
    flex: 1,
    minHeight: 112,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: spacing.xs,
    paddingTop: spacing.base,
    paddingBottom: spacing.base,
    alignSelf: 'stretch' as const,
  },
  gridTitle: {
    ...typography.h4,
    color: colors.textPrimary,
    textAlign: 'center' as const,
    marginTop: spacing.xs,
  },
  gridSubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center' as const,
    lineHeight: 16,
  },
  spacer: { flex: 1 },
  // Pinned to the card's top end corner so it never shifts the centred icon and title.
  portalTag: { position: 'absolute' as const, top: spacing.xs, end: spacing.xs },
}));
