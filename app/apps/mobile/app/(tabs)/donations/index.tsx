// Donations Hub — ONE list of giving worlds in a 2-column grid (D100, FR-DONATE-001).
// Mapped to: FR-DONATE-001 / FR-DONATE-006 / D-16 / D100.
//
// Visual hierarchy (mobile-first):
//   1. Hero with title + tagline ("Give. Take. Donate what you have.")
//   2. The giving worlds, all of them in one list: no featured card, no second "domains"
//      section. A world with no active flow yet carries a "portal" tag (D60) and sits after
//      the active worlds; each group follows the member's recent visits (FR-DONATE-001 AC8).
//
// Each tile uses the shared Card + IconTile primitives so it stays in lock-step
// with the rest of the redesigned main-screen idiom (welcome-style cream
// backdrop, soft shadow, orange-tinted icon tiles, staggered spring entries).
import React, { useMemo } from 'react';
import { ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { TopBar } from '../../../src/components/TopBar';
import { Screen } from '../../../src/components/ui/Screen';
import { MotionEntry, ENTRY_DELAY } from '../../../src/components/ui/MotionEntry';
import { useShellTabBarScrollInset } from '../../../src/navigation/useShellTabBarVisibility';
import { useScreenAside } from '../../../src/components/aside/useScreenAside';
import { CommunityStatsAside } from '../../../src/components/aside/CommunityStatsAside';
import { rtlTextAlignStart } from '../../../src/lib/rtlTextAlignStart';
import { MatchesForYouCard } from '../../../src/components/matching/MatchesForYouCard';
import { useRemoteAppFlags } from '../../../src/hooks/useLaunchWorldFlags';
import { HubTileGrid } from '../../../src/components/donations/HubTileGrid';
import { donationsHubTiles } from '../../../src/navigation/donationsHubTiles';
import { useHubWorldOrder } from '../../../src/hooks/useHubWorldOrder';

export { RouteErrorBoundary as ErrorBoundary } from '../../../src/components/RouteErrorBoundary';

const useStyles = makeUseStyles(({ colors }) => ({
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


}));

export default function DonationsHubScreen() {
  const { t } = useTranslation();
  const styles = useStyles();
  const tabBarPad = useShellTabBarScrollInset();
  const remoteFlags = useRemoteAppFlags();
  // D60 — every world is shown; portal worlds (flag off) say they offer links and knowledge.
  const tiles = useMemo(
    () =>
      donationsHubTiles(remoteFlags).map(({ tile, mode }) =>
        mode === 'portal'
          ? { ...tile, subtitleKey: 'donations.worldLaunch.portalTileSubtitle', portal: true }
          : tile,
      ),
    [remoteFlags],
  );
  // FR-DONATE-001 AC8 — active worlds first, then portals, each by this member's recent visits.
  const { ordered, recordOpen } = useHubWorldOrder(tiles);

  // Desktop (>=1024) aside — live community snapshot (FR-RESP-003).
  useScreenAside(() => <CommunityStatsAside />, []);

  return (
    <Screen blobs="off">
      <TopBar />
      <ScrollView
        testID="donations-hub"
        style={styles.scrollView}
        // RN-Web + `dir=rtl`: content can shrink-wrap and hug the inline-start
        // edge (visual right), leaving empty space on the left — stretch to viewport.
        contentContainerStyle={[styles.scroll, { paddingBottom: tabBarPad }]}
        showsVerticalScrollIndicator={false}
      >
        <MotionEntry variant="hero" delay={ENTRY_DELAY.hero} style={styles.heroBlock}>
          <Text style={styles.heroTitle}>{t('donations.hubHeroTitle')}</Text>
          <Text style={styles.heroSubtitle}>{t('donations.hubHeroSubtitle')}</Text>
        </MotionEntry>
        <MatchesForYouCard />
        <HubTileGrid
          heading={t('donations.hubCategoriesSectionTitle')}
          tiles={ordered}
          onTilePress={recordOpen}
          delay={ENTRY_DELAY.section}
        />
      </ScrollView>
    </Screen>
  );
}
