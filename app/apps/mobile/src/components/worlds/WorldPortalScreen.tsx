// D60 (docs/spec/04_product_structure.md): a world whose launch flag is off is
// a portal — it is still shown in full, with its links and knowledge (the
// FR-DONATE-006 links list, then the curated organizations, related worlds and
// knowledge topics) — instead of a "coming soon" dead end. The money
// portal also keeps the support-KC card (FR-DONATE-011) and the jgive card (FR-DONATE-003).
import React from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { worldSlugOfLinkList, type DonationCategorySlug } from '@kc/domain';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { Screen } from '../ui/Screen';
import { PrimaryButton } from '../ui/Buttons';
import { DonationLinksList } from '../DonationLinksList';
import { WorldCuratedContent } from '../giving/WorldCuratedContent';
import { SupportKcCard } from '../money/SupportKcCard';
import { PartnerNonprofitsCard } from '../money/PartnerNonprofitsCard';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { useShellTabBarScrollInset } from '../../navigation/useShellTabBarVisibility';

const useStyles = makeUseStyles(({ colors }) => ({
  body: { padding: spacing.lg, gap: spacing.md },
  title: { ...typography.h2, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  subtitle: { ...typography.body, color: colors.textSecondary, textAlign: rtlTextAlignStart },
}));

export function WorldPortalScreen({ categorySlug }: Readonly<{ categorySlug?: DonationCategorySlug }>) {
  const { t } = useTranslation();
  const styles = useStyles();
  const router = useRouter();
  const tabBarPad = useShellTabBarScrollInset();

  return (
    <Screen>
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: tabBarPad }]} testID="world-portal">
        <Text style={styles.title}>{t('donations.worldLaunch.portalTitle')}</Text>
        <Text style={styles.subtitle}>{t('donations.worldLaunch.portalBody')}</Text>
        {categorySlug === 'money' ? (
          <>
            <SupportKcCard testID="world-portal-support-kc" />
            <PartnerNonprofitsCard />
          </>
        ) : null}
        {categorySlug ? <DonationLinksList categorySlug={categorySlug} /> : null}
        {/* Organizations, related worlds and knowledge topics of the world (FR-FEED-020 AC7). */}
        {categorySlug ? <WorldCuratedContent worldSlug={worldSlugOfLinkList(categorySlug)} /> : null}
        <View>
          <PrimaryButton
            label={t('donations.worldLaunch.backToHub')}
            icon="arrow-back"
            onPress={() => router.replace('/(tabs)/donations')}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}
