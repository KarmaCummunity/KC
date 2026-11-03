// Donation Hub tile — used by /(tabs)/donations.
// Mapped to: FR-DONATE-001 AC2 / FR-DONATE-006 / D-16.
//
// Two layouts:
//   - default (`compact={false}`): full-width row, IconTile on right, chevron on left.
//   - compact (`compact={true}`):  square card optimised for a 2-column grid.
//
// Visual idiom matches the welcome screen: white Card surface with a soft
// shadow, orange-tinted IconTile, RTL-aware row layout, and a haptic
// scale-press handled by the Card / PressableScale primitives.
import React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { makeUseStyles, radius, spacing, typography, iconSize, useTheme, Text } from '@kc/ui';
import { PressableScale } from './animations/PressableScale';
import { Card } from './ui/Card';
import { MirroredIcon } from './ui/MirroredIcon';
import { IconTile } from './ui/IconTile';
import { rtlTextAlignStart } from '../lib/rtlTextAlignStart';
import { rowDirectionStart } from '../lib/rtlLayout';

interface DonationTileProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  onPress: () => void;
  compact?: boolean;
  testID?: string;
}

const useStyles = makeUseStyles(({ colors }) => ({
  row: {
    minHeight: 96,
    flexDirection: rowDirectionStart,
    alignItems: 'center' as const,
    gap: spacing.lg,
    borderRadius: radius.lg,
  },
  compactWrap: { flex: 1 },
  compactCard: {
    minHeight: 148,
    alignItems: 'center' as const,
    justifyContent: 'flex-start' as const,
    gap: spacing.xs,
  },
  compactIcon: { marginBottom: spacing.xs },
  textBlock: { flex: 1 },
  title: { ...typography.h3, color: colors.textPrimary, marginBottom: spacing.xs, textAlign: rtlTextAlignStart },
  subtitle: { ...typography.body, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  titleCompact: { ...typography.h4, color: colors.textPrimary, textAlign: 'center' as const },
  subtitleCompact: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    textAlign: 'center' as const,
  },
}));

export function DonationTile({
  icon,
  title,
  subtitle,
  onPress,
  compact = false,
  testID,
}: DonationTileProps) {
  const { colors } = useTheme();
  const styles = useStyles();

  if (compact) {
    return (
      <PressableScale
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${title} — ${subtitle}`}
        style={styles.compactWrap}
      >
        <Card padding="md" style={styles.compactCard} testID={testID}>
          <View style={styles.compactIcon}>
            <IconTile icon={icon} size="lg" />
          </View>
          <Text style={styles.titleCompact} numberOfLines={1}>{title}</Text>
          <Text style={styles.subtitleCompact} numberOfLines={2}>{subtitle}</Text>
        </Card>
      </PressableScale>
    );
  }

  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title} — ${subtitle}`}
    >
      <Card padding="lg" style={styles.row} testID={testID}>
        <IconTile icon={icon} size="md" />
        <View style={styles.textBlock}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
        <MirroredIcon name="chevron-forward" size={iconSize.xl} color={colors.textSecondary} />
      </Card>
    </PressableScale>
  );
}
