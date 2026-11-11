// Mapped to spec: FR-FEED-020 AC2 — the top of a giving world's feed: a one-line intro and
// optional extra content. The world's own screens are a menu under the world title in the TopBar (`useWorldHeader`) and the
// search / filters sit in the world's filter sheet, so the feed is the first thing seen, as on
// the main feed. A short list of the world's links sits under the feed (`WorldLinksPreview`).
// There are no request / offer buttons: the "+" tab opens the form on this world (D100).
import React from 'react';
import { View } from 'react-native';
import type { Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, iconSize, spacing, typography, useTheme, Text } from '@kc/ui';
import { rowDirectionStart } from '../../lib/rtlLayout';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';

const useStyles = makeUseStyles(({ colors }) => ({
  intro: {
    flexDirection: rowDirectionStart,
    alignItems: 'center' as const,
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  introText: {
    ...typography.caption,
    color: colors.textSecondary,
    flex: 1,
    textAlign: rtlTextAlignStart,
  },
}));

/** A link to one of the world's own screens (my handoffs, my rides, shifts…). */
export interface WorldSubScreenLink {
  readonly labelKey: string;
  readonly path: Href;
  readonly testID: string;
}

export interface WorldHubHeaderProps {
  readonly icon: 'car-outline' | 'school-outline' | 'gift-outline' | 'restaurant-outline' | 'home-outline' | 'time-outline' | 'paw-outline' | 'trophy-outline';
  readonly introKey: string;
  /** The world's own screens, in display order (the title menu, `useWorldHeader`). */
  readonly subScreens?: readonly WorldSubScreenLink[];
  /** Extra header content under the intro (e.g. the time world's opportunities). */
  readonly headerExtra?: React.ReactNode;
}

export function WorldHubHeader({ icon, introKey, headerExtra }: Omit<WorldHubHeaderProps, 'subScreens'>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <>
      <View style={styles.intro}>
        <Ionicons name={icon} size={iconSize.md} color={colors.primary} />
        <Text style={styles.introText} numberOfLines={2}>{t(introKey)}</Text>
      </View>
      {headerExtra}
    </>
  );
}
