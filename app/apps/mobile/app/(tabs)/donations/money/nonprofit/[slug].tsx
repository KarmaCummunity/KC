import React from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { makeUseStyles, radius, spacing, typography, Text } from '@kc/ui';
import { Screen } from '../../../../../src/components/ui/Screen';
import { PrimaryButton, SecondaryButton } from '../../../../../src/components/ui/Buttons';
import { CampaignProgressBar } from '../../../../../src/components/money/CampaignProgressBar';
import { paymentsUseCases } from '../../../../../src/services/paymentsComposition';
import { useShellTabBarScrollInset } from '../../../../../src/navigation/useShellTabBarVisibility';
import { useExternalDonations } from '../../../../../src/hooks/useExternalDonations';

/** Narrowest a donate action may get before the pair wraps (a layout size, in points). */
const ACTION_MIN_WIDTH = 140;

const useStyles = makeUseStyles(({ colors }) => ({
  body: { padding: spacing.lg, gap: spacing.lg },
  title: { ...typography.h2, color: colors.textPrimary },
  about: { ...typography.body, color: colors.textSecondary },
  stat: { ...typography.bodyLarge, ...typography.bold, color: colors.textPrimary },
  campaign: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceRaised, gap: spacing.sm },
  campaignTitle: { ...typography.bodyLarge, color: colors.textPrimary },
  actions: { flexDirection: 'row' as const, gap: spacing.md, flexWrap: 'wrap' as const },
  // Side by side while both fit; the second wraps under the first on narrow screens.
  action: { flex: 1, minWidth: ACTION_MIN_WIDTH },
}));

export default function NonprofitPublicScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const styles = useStyles();
  const inset = useShellTabBarScrollInset();
  const { external, openExternal } = useExternalDonations();
  const page = useQuery({
    queryKey: ['money', 'nonprofit', slug],
    queryFn: () => paymentsUseCases.getNonprofitPage().execute(slug!),
    enabled: Boolean(slug),
  });

  const p = page.data;
  if (page.isLoading) {
    return (
      <Screen>
        <Text style={{ padding: spacing.lg }}>{t('moneyPayments.loading')}</Text>
      </Screen>
    );
  }
  if (!p) {
    return (
      <Screen>
        <Text style={{ padding: spacing.lg }}>{t('moneyPayments.nonprofitNotFound')}</Text>
      </Screen>
    );
  }

  const about = i18n.language.startsWith('he') ? p.aboutHe : p.aboutEn;
  const tagline = i18n.language.startsWith('he') ? p.taglineHe : p.taglineEn;

  return (
    <Screen>
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: inset }]}>
        <Text style={styles.title}>{p.name}</Text>
        {tagline ? <Text style={styles.about}>{tagline}</Text> : null}
        {about ? <Text style={styles.about}>{about}</Text> : null}
        <Text style={styles.stat}>
          {t('moneyPayments.totalRaised', { amount: p.totalRaisedIls.toFixed(0) })}
        </Text>

        <View style={styles.actions}>
          <View style={styles.action}>
            <PrimaryButton
              label={t('moneyPayments.donateNow')}
              size="md"
              fullWidth
              onPress={() =>
                external
                  ? void openExternal('donate', p.orgId)
                  : router.push({ pathname: '/(tabs)/donations/money/donate/[orgId]', params: { orgId: p.orgId } })
              }
            />
          </View>
          <View style={styles.action}>
            <SecondaryButton
              label={t('moneyPayments.monthlyGift')}
              size="md"
              fullWidth
              onPress={() =>
                external
                  ? void openExternal('standing-order', p.orgId)
                  : router.push({
                      pathname: '/(tabs)/donations/money/standing-order/[orgId]',
                      params: { orgId: p.orgId },
                    })
              }
            />
          </View>
        </View>

        <Text style={styles.title}>{t('moneyPayments.campaignsSection')}</Text>
        {p.campaigns.length === 0 ? (
          <Text style={styles.about}>{t('moneyPayments.noCampaigns')}</Text>
        ) : (
          p.campaigns.map((c) => (
            <View key={c.listingId} style={styles.campaign}>
              <Text style={styles.campaignTitle}>{c.title}</Text>
              {c.summary ? <Text style={styles.about}>{c.summary}</Text> : null}
              <CampaignProgressBar
                raisedIls={c.raisedIls}
                goalIls={c.goalIls}
                label={t('moneyPayments.campaignProgress', {
                  raised: c.raisedIls.toFixed(0),
                  goal: c.goalIls.toFixed(0),
                })}
              />
            </View>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}
