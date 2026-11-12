// FR-DONATE-006/007 — generic donation category screen.
// Renders DonationLinksList for any link-only world: medical, animals, democracy, employment,
// challenges (D100), plus the legacy food / housing / transport / knowledge category links.
import React from 'react';
import { ScrollView, View } from 'react-native';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  DONATION_CATEGORY_SLUGS,
  worldSlugOfLinkList,
  type DonationCategorySlug,
} from '@kc/domain';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import type { Ionicons } from '@expo/vector-icons';
import { DonationLinksList } from '../../../../src/components/DonationLinksList';
import { MedicalBodiesSection } from '../../../../src/components/MedicalBodiesSection';
import { WorldCuratedContent } from '../../../../src/components/giving/WorldCuratedContent';
import { Screen } from '../../../../src/components/ui/Screen';
import { IconTile } from '../../../../src/components/ui/IconTile';
import { MotionEntry, ENTRY_DELAY } from '../../../../src/components/ui/MotionEntry';
import { useShellTabBarScrollInset } from '../../../../src/navigation/useShellTabBarVisibility';
import { rtlTextAlignStart } from '../../../../src/lib/rtlTextAlignStart';

export { RouteErrorBoundary as ErrorBoundary } from '../../../../src/components/RouteErrorBoundary';

const ICON_BY_SLUG: Record<DonationCategorySlug, keyof typeof Ionicons.glyphMap> = {
  time: 'time-outline',
  money: 'cash-outline',
  food: 'restaurant-outline',
  housing: 'home-outline',
  transport: 'car-outline',
  knowledge: 'school-outline',
  animals: 'paw-outline',
  medical: 'medical-outline',
  democracy: 'megaphone-outline',
  employment: 'briefcase-outline',
  challenges: 'trophy-outline',
};

const I18N_KEY_BY_SLUG: Record<
  Exclude<DonationCategorySlug, 'time' | 'money'>,
  'food' | 'housing' | 'transport' | 'knowledge' | 'animals' | 'medical' | 'democracy' | 'employment' | 'challenges'
> = {
  food: 'food',
  housing: 'housing',
  transport: 'transport',
  knowledge: 'knowledge',
  animals: 'animals',
  medical: 'medical',
  democracy: 'democracy',
  employment: 'employment',
  challenges: 'challenges',
};

function isCategorySlug(value: unknown): value is DonationCategorySlug {
  return typeof value === 'string' && (DONATION_CATEGORY_SLUGS as readonly string[]).includes(value);
}

const useStyles = makeUseStyles(({ colors }) => ({
  scrollOuter: { flex: 1 },
  // `paddingBottom` is supplied dynamically by `useShellTabBarScrollInset()`
  // so the last link clears the floating tab-bar pill (FR-RESP-006).
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center' as const,
    gap: spacing.lg,
  },
  hero: { alignItems: 'center' as const, gap: spacing.sm },
  heroIcon: { marginBottom: spacing.xs },
  heroTitle: {
    ...typography.h1,
    color: colors.textPrimary,
    textAlign: 'center' as const,
    letterSpacing: -0.4,
  },
  heroSubtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center' as const,
  },
  body: {
    ...typography.bodyLarge,
    color: colors.textPrimary,
    textAlign: rtlTextAlignStart,
    lineHeight: 26,
    width: '100%',
  },
}));

export default function DonationCategoryScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { t } = useTranslation();
  const styles = useStyles();
  const tabBarPad = useShellTabBarScrollInset();

  if (!isCategorySlug(slug) || slug === 'time' || slug === 'money') {
    return <Redirect href="/(tabs)/donations" />;
  }

  const titleKey = I18N_KEY_BY_SLUG[slug];
  const title = t(`donations.categories.${titleKey}.title`);
  const subtitle = t(`donations.categories.${titleKey}.subtitle`);
  const body = t(`donations.categories.${titleKey}.body`);
  const iconName = ICON_BY_SLUG[slug];

  return (
    <Screen blobs="off">
      <ScrollView
        style={styles.scrollOuter}
        contentContainerStyle={[styles.scroll, { paddingBottom: tabBarPad }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <MotionEntry variant="hero" delay={ENTRY_DELAY.hero} style={styles.hero}>
          <View style={styles.heroIcon}><IconTile icon={iconName} size="lg" /></View>
          <Text style={styles.heroTitle}>{title}</Text>
          <Text style={styles.heroSubtitle}>{subtitle}</Text>
        </MotionEntry>

        <MotionEntry variant="bottom" delay={ENTRY_DELAY.section}>
          <Text style={styles.body}>{body}</Text>
        </MotionEntry>

        {/* FR-DONATE-011 — curated life-saving directory precedes the community list. */}
        {slug === 'medical' && (
          <MotionEntry variant="bottom" delay={ENTRY_DELAY.section + 40}>
            <MedicalBodiesSection />
          </MotionEntry>
        )}

        <MotionEntry variant="bottom" delay={ENTRY_DELAY.section + 80}>
          <DonationLinksList categorySlug={slug} />
        </MotionEntry>

        {/* Curated organizations, related worlds and knowledge topics of the world (migration 0024). */}
        <MotionEntry variant="bottom" delay={ENTRY_DELAY.section + 120}>
          <WorldCuratedContent worldSlug={worldSlugOfLinkList(slug)} />
        </MotionEntry>
      </ScrollView>
    </Screen>
  );
}
