// Donations · Money hub — FR-DONATE-003 / FR-DONATE-011 (D20, D37).
// Top to bottom: hero → support KC directly (one-time + standing order) →
// partner nonprofits (jgive) → community NGO links (FR-DONATE-007..009) →
// in-app verified-nonprofit flow, only while `money_in_app_org_payments` is on.
import React from 'react';
import { ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { Screen } from '../../../../src/components/ui/Screen';
import { IconTile } from '../../../../src/components/ui/IconTile';
import { MotionEntry, ENTRY_DELAY } from '../../../../src/components/ui/MotionEntry';
import { DonationLinksList } from '../../../../src/components/DonationLinksList';
import { SupportKcCard } from '../../../../src/components/money/SupportKcCard';
import { PartnerNonprofitsCard } from '../../../../src/components/money/PartnerNonprofitsCard';
import { VerifiedNonprofitsSection } from '../../../../src/components/money/VerifiedNonprofitsSection';
import { useFeatureFlag } from '../../../../src/hooks/useFeatureFlag';
import { useShellTabBarScrollInset } from '../../../../src/navigation/useShellTabBarVisibility';
import { WorldLaunchGateByFlag } from '../../../../src/components/worlds/WorldLaunchGate';
import { rtlTextAlignStart } from '../../../../src/lib/rtlTextAlignStart';

export { RouteErrorBoundary as ErrorBoundary } from '../../../../src/components/RouteErrorBoundary';

const useStyles = makeUseStyles(({ colors }) => ({
  scrollView: { flex: 1 },
  // `paddingBottom` comes from `useShellTabBarScrollInset()` so the last section
  // clears the floating tab-bar pill (FR-RESP-006).
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    maxWidth: 580,
    width: '100%',
    alignSelf: 'center' as const,
    gap: spacing.lg,
  },
  hero: { alignItems: 'center' as const, gap: spacing.md },
  body: {
    ...typography.bodyLarge,
    color: colors.textPrimary,
    textAlign: rtlTextAlignStart,
    lineHeight: 26,
    width: '100%',
  },
}));

function MoneyHubScreen() {
  const { t } = useTranslation();
  const styles = useStyles();
  const tabBarPad = useShellTabBarScrollInset();
  const showInAppOrgPayments = useFeatureFlag('money_in_app_org_payments');

  return (
    <Screen blobs="off">
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scroll, { paddingBottom: tabBarPad }]}
        showsVerticalScrollIndicator={false}
      >
        <MotionEntry variant="hero" delay={ENTRY_DELAY.hero} style={styles.hero}>
          <IconTile icon="cash-outline" size="lg" />
          <Text style={styles.body}>{t('donations.moneyScreen.body')}</Text>
        </MotionEntry>

        <MotionEntry variant="bottom" delay={ENTRY_DELAY.section}>
          <SupportKcCard />
        </MotionEntry>

        <PartnerNonprofitsCard />
        <DonationLinksList categorySlug="money" />
        {showInAppOrgPayments ? <VerifiedNonprofitsSection /> : null}
      </ScrollView>
    </Screen>
  );
}

export default function MoneyHubRoute() {
  return (
    <WorldLaunchGateByFlag flagKey="world_money_enabled">
      <MoneyHubScreen />
    </WorldLaunchGateByFlag>
  );
}
