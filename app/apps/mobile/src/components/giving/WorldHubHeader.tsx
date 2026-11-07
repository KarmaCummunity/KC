// Mapped to spec: FR-FEED-020 AC2 — the top of a giving world's screen: intro, links to the
// world's own sub-screens (my handoffs, my rides…) and optional extra content. The curated links
// list is not here: it sits under the feed (`WorldLinksSection`) so the feed is the first thing seen.
// There are no request / offer buttons: the "+" tab opens the form on this world (D100).
import React from 'react';
import { View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, Text } from '@kc/ui';
import { IconTile } from '../ui/IconTile';
import { GhostButton } from '../ui/Buttons';
import { worldHubBaseStyles } from './worldHubStyles';

const useStyles = makeUseStyles(({ colors }) => ({
  hero: worldHubBaseStyles(colors).hero,
  body: worldHubBaseStyles(colors).body,
  links: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
}));

/** A link to one of the world's own screens (my handoffs, my rides, shifts…). */
export interface WorldSubScreenLink {
  readonly labelKey: string;
  readonly path: Href;
  readonly testID: string;
}

export interface WorldHubHeaderProps {
  readonly icon: 'car-outline' | 'school-outline' | 'gift-outline' | 'restaurant-outline' | 'home-outline' | 'time-outline' | 'paw-outline';
  readonly introKey: string;
  /** The world's own screens, in display order. */
  readonly subScreens?: readonly WorldSubScreenLink[];
  /** Extra header content under the links (e.g. the rides route search). */
  readonly headerExtra?: React.ReactNode;
}

export function WorldHubHeader({ icon, introKey, subScreens = [], headerExtra }: WorldHubHeaderProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const styles = useStyles();
  return (
    <>
      <View style={styles.hero}>
        <IconTile icon={icon} size="lg" />
        <Text style={styles.body}>{t(introKey)}</Text>
      </View>
      {subScreens.length > 0 ? (
        <View style={styles.links}>
          {subScreens.map((link) => (
            <GhostButton
              key={link.testID}
              testID={link.testID}
              size="sm"
              label={t(link.labelKey)}
              onPress={() => router.push(link.path)}
            />
          ))}
        </View>
      ) : null}
      {headerExtra}
    </>
  );
}
