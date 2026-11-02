// D62 — a screen per domain (docs/spec/06_domain_hubs.md): what the domain is,
// plus the links list where one exists (medical, animals). Posts by domain
// follow once posts carry a domain (G24).
import React from 'react';
import { ScrollView, View } from 'react-native';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { DONATION_CATEGORY_SLUGS, isDomainSlug, type DonationCategorySlug } from '@kc/domain';
import { makeUseStyles, spacing, Text, typography } from '@kc/ui';
import { Screen } from '../../../../src/components/ui/Screen';
import { IconTile } from '../../../../src/components/ui/IconTile';
import { DonationLinksList } from '../../../../src/components/DonationLinksList';
import { DONATIONS_HUB_DOMAIN_TILES } from '../../../../src/navigation/donationsHubTiles';
import { useShellTabBarScrollInset } from '../../../../src/navigation/useShellTabBarVisibility';
import { rtlTextAlignStart } from '../../../../src/lib/rtlTextAlignStart';

export { RouteErrorBoundary as ErrorBoundary } from '../../../../src/components/RouteErrorBoundary';

const useStyles = makeUseStyles(({ colors }) => ({
  body: { padding: spacing.lg, gap: spacing.md, maxWidth: 480, width: '100%', alignSelf: 'center' as const },
  hero: { alignItems: 'center' as const, gap: spacing.sm },
  title: { ...typography.h1, color: colors.textPrimary, textAlign: 'center' as const },
  subtitle: { ...typography.body, color: colors.textSecondary, textAlign: rtlTextAlignStart },
}));

export default function DomainHubScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { t } = useTranslation();
  const styles = useStyles();
  const tabBarPad = useShellTabBarScrollInset();
  const tile = DONATIONS_HUB_DOMAIN_TILES.find((d) => d.key === slug);
  if (!slug || !isDomainSlug(slug) || !tile) return <Redirect href="/(tabs)/donations" />;
  const linksSlug = (DONATION_CATEGORY_SLUGS as readonly string[]).includes(slug) ? (slug as DonationCategorySlug) : null;

  return (
    <Screen blobs="content">
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: tabBarPad }]} testID={`domain-hub-${slug}`}>
        <View style={styles.hero}>
          <IconTile icon={tile.icon} size="lg" />
          <Text style={styles.title}>{t(tile.titleKey)}</Text>
        </View>
        <Text style={styles.subtitle}>{t(`donations.worldsHub.domains.${slug}.body`)}</Text>
        {linksSlug ? <DonationLinksList categorySlug={linksSlug} /> : null}
      </ScrollView>
    </Screen>
  );
}
