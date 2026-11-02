// Mapped to spec: FR-FEED-020 AC2 — the top of a giving world's screen: intro, "request" and
// "offer" buttons that open the create form preset to this world and direction, links to the
// world's own sub-screens (my handoffs, my rides…), optional extra content and curated links.
import React from 'react';
import { View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, Text } from '@kc/ui';
import { IconTile } from '../ui/IconTile';
import { GhostButton, PrimaryButton, SecondaryButton } from '../ui/Buttons';
import { DonationLinksList } from '../DonationLinksList';
import { createRouteFor, isCreateCategoryId } from '../../lib/unifiedCreate/createCategories';
import { worldHubBaseStyles } from './worldHubStyles';

const useStyles = makeUseStyles(({ colors }) => ({
  hero: worldHubBaseStyles(colors).hero,
  body: worldHubBaseStyles(colors).body,
  actions: { flexDirection: 'row' as const, gap: spacing.md, paddingHorizontal: spacing.lg },
  action: { flex: 1 },
  links: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  secondary: { marginTop: spacing.lg, paddingHorizontal: spacing.lg },
}));

/** A link to one of the world's own screens (my handoffs, my rides, shifts…). */
export interface WorldSubScreenLink {
  readonly labelKey: string;
  readonly path: Href;
  readonly testID: string;
}

export interface WorldHubHeaderProps {
  readonly worldSlug: string;
  readonly icon: 'car-outline' | 'school-outline' | 'gift-outline' | 'restaurant-outline' | 'home-outline' | 'time-outline';
  readonly introKey: string;
  /** Curated external links under the header (donation links category). */
  readonly linksCategory?: 'transport' | 'knowledge';
  /** The world's own screens, in display order. */
  readonly subScreens?: readonly WorldSubScreenLink[];
  /** Extra header content under the links (e.g. the rides route search). */
  readonly headerExtra?: React.ReactNode;
}

export function WorldHubHeader({ worldSlug, icon, introKey, linksCategory, subScreens = [], headerExtra }: WorldHubHeaderProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const styles = useStyles();
  return (
    <>
      <View style={styles.hero}>
        <IconTile icon={icon} size="lg" />
        <Text style={styles.body}>{t(introKey)}</Text>
      </View>
      {isCreateCategoryId(worldSlug) ? (
        // One primary action per area: offering is the giving action, requesting the secondary.
        <View style={styles.actions}>
          <View style={styles.action}>
            <SecondaryButton
              testID="world-hub-request"
              size="md"
              icon="hand-left-outline"
              label={t('donations.worldFeed.request')}
              accessibilityLabel={t('donations.worldFeed.requestA11y')}
              onPress={() => router.push(createRouteFor(worldSlug, 'request'))}
            />
          </View>
          <View style={styles.action}>
            <PrimaryButton
              testID="world-hub-offer"
              size="md"
              icon="gift-outline"
              label={t('donations.worldFeed.offer')}
              accessibilityLabel={t('donations.worldFeed.offerA11y')}
              onPress={() => router.push(createRouteFor(worldSlug, 'give'))}
            />
          </View>
        </View>
      ) : null}
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
      {linksCategory ? (
        <View style={styles.secondary}>
          <DonationLinksList categorySlug={linksCategory} />
        </View>
      ) : null}
    </>
  );
}
