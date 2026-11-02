// Donations Hub — featured "items" tile + 8 categorized tiles in a 2-column grid.
// Mapped to: FR-DONATE-001 / FR-DONATE-006 / D-16.
//
// Visual hierarchy (mobile-first):
//   1. Hero with title + tagline ("Give. Take. Donate what you have.")
//   2. Featured row card for "items" — the MVP's primary action (FR-DONATE-001).
//   3. Section heading + 2-column grid for the eight category tiles.
//
// Each tile uses the shared Card + IconTile primitives so it stays in lock-step
// with the rest of the redesigned main-screen idiom (welcome-style cream
// backdrop, soft shadow, orange-tinted icon tiles, staggered spring entries).
import React from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { iconSize, makeUseStyles, radius, spacing, typography, useTheme, Text } from '@kc/ui';
import { TopBar } from '../../../src/components/TopBar';
import { PressableScale } from '../../../src/components/animations/PressableScale';
import { Screen } from '../../../src/components/ui/Screen';
import { Card } from '../../../src/components/ui/Card';
import { IconTile } from '../../../src/components/ui/IconTile';
import { MotionEntry, ENTRY_DELAY } from '../../../src/components/ui/MotionEntry';
import { useShellTabBarScrollInset } from '../../../src/navigation/useShellTabBarVisibility';
import { useScreenAside } from '../../../src/components/aside/useScreenAside';
import { CommunityStatsAside } from '../../../src/components/aside/CommunityStatsAside';
import { rtlTextAlignStart } from '../../../src/lib/rtlTextAlignStart';
import { MatchesForYouCard } from '../../../src/components/matching/MatchesForYouCard';
import { useRemoteAppFlags } from '../../../src/hooks/useLaunchWorldFlags';
import { isHubTileLaunchEnabled } from '@kc/domain';
import { HubTileGrid } from '../../../src/components/donations/HubTileGrid';
import {
  DONATIONS_HUB_DOMAIN_TILES,
  DONATIONS_HUB_FEATURED,
  donationsHubTiles,
} from '../../../src/navigation/donationsHubTiles';

export { RouteErrorBoundary as ErrorBoundary } from '../../../src/components/RouteErrorBoundary';

const useStyles = makeUseStyles(({ colors, isDark }) => ({
  scrollView: { flex: 1, width: '100%', alignSelf: 'stretch' as const },
  // `paddingBottom` is supplied dynamically by `useShellTabBarScrollInset()`
  // so the last row clears the floating tab-bar pill (FR-RESP-006).
  scroll: {
    flexGrow: 1,
    alignSelf: 'stretch' as const,
    minWidth: '100%',
    paddingHorizontal: spacing.lg,
    width: '100%',
  },

  // Hero — large title + subtitle, mirrors the welcome screen scale.
  // `width: '100%'` + `rtlTextAlignStart` keeps Hebrew flush to visual right on web + native.
  heroBlock: {
    width: '100%',
    paddingTop: spacing.base,
    paddingBottom: spacing.lg,
  },
  heroTitle: {
    ...typography.h1,
    color: colors.textPrimary,
    letterSpacing: -0.4,
    textAlign: rtlTextAlignStart,
    width: '100%',
  },
  heroSubtitle: {
    ...typography.bodyLarge,
    color: colors.textSecondary,
    textAlign: rtlTextAlignStart,
    marginTop: spacing.xs,
    width: '100%',
  },

  // Featured items row — IconTile on the start edge, chevron on the end edge.
  // `flexDirection: 'row'` lets RTL flip the order natively, matching the
  // SettingsScreenRow / DonationLinkRow conventions used elsewhere.
  featuredCard: {
    minHeight: 88,
    width: '100%',
    alignSelf: 'stretch' as const,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.base,
    borderRadius: radius.xl,
    borderWidth: isDark ? 1 : 1.5,
    borderColor: isDark ? colors.border : colors.primarySurface,
    marginBottom: spacing.lg,
  },
  featuredText: { flex: 1 },
  featuredTitle: {
    ...typography.h2,
    color: colors.textPrimary,
    textAlign: rtlTextAlignStart,
    marginBottom: spacing.xs,
  },
  featuredSubtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: rtlTextAlignStart,
  },

  // RN-Web + RTL: nested blocks can shrink-wrap to inline-start without explicit stretch.
  blockStretch: { width: '100%', alignSelf: 'stretch' as const },
}));

export default function DonationsHubScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useStyles();
  const tabBarPad = useShellTabBarScrollInset();
  const remoteFlags = useRemoteAppFlags();
  const showFeaturedItems = isHubTileLaunchEnabled('items', remoteFlags);
  // D60 — every world is shown; portal worlds (flag off) say they offer links and knowledge.
  const visibleTiles = donationsHubTiles(remoteFlags).map(({ tile, mode }) =>
    mode === 'portal' ? { ...tile, subtitleKey: 'donations.worldLaunch.portalTileSubtitle' } : tile,
  );

  // Desktop (>=1024) aside — live community snapshot (FR-RESP-003).
  useScreenAside(() => <CommunityStatsAside />, []);

  return (
    <Screen blobs="content">
      <TopBar />
      <ScrollView
        testID="donations-hub"
        style={styles.scrollView}
        // RN-Web + `dir=rtl`: content can shrink-wrap and hug the inline-start
        // edge (visual right), leaving empty space on the left — stretch to viewport.
        contentContainerStyle={[styles.scroll, { paddingBottom: tabBarPad }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Hero ─────────────────────────── */}
        <MotionEntry variant="hero" delay={ENTRY_DELAY.hero} style={styles.heroBlock}>
          <Text style={styles.heroTitle}>{t('donations.hubHeroTitle')}</Text>
          <Text style={styles.heroSubtitle}>{t('donations.hubHeroSubtitle')}</Text>
        </MotionEntry>
        <MatchesForYouCard />
        {showFeaturedItems ? (
          <MotionEntry variant="bottom" delay={ENTRY_DELAY.section} style={styles.blockStretch}>
            <PressableScale
              onPress={() => router.push(DONATIONS_HUB_FEATURED.href)}
              accessibilityRole="button"
              accessibilityLabel={`${t(DONATIONS_HUB_FEATURED.titleKey)} — ${t(DONATIONS_HUB_FEATURED.subtitleKey)}`}
              style={styles.blockStretch}
            >
              <Card padding="base" style={styles.featuredCard} testID={DONATIONS_HUB_FEATURED.testID}>
                <IconTile icon={DONATIONS_HUB_FEATURED.icon} size="lg" />
                <View style={styles.featuredText}>
                  <Text style={styles.featuredTitle} numberOfLines={1}>
                    {t(DONATIONS_HUB_FEATURED.titleKey)}
                  </Text>
                  <Text style={styles.featuredSubtitle} numberOfLines={2}>
                    {t(DONATIONS_HUB_FEATURED.subtitleKey)}
                  </Text>
                </View>
                <Ionicons name="chevron-back" size={iconSize.xl} color={colors.primary} />
              </Card>
            </PressableScale>
          </MotionEntry>
        ) : null}

        {/* ── Giving worlds, then domains (D62) ── */}
        <HubTileGrid
          heading={t('donations.hubCategoriesSectionTitle')}
          tiles={visibleTiles}
          delay={ENTRY_DELAY.section + 80}
        />
        <HubTileGrid
          heading={t('donations.worldsHub.domainsSectionTitle')}
          tiles={DONATIONS_HUB_DOMAIN_TILES}
          delay={ENTRY_DELAY.section + 160}
        />
      </ScrollView>
    </Screen>
  );
}
