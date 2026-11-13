// Pro paywall / upgrade screen (#1085). Behind feature flag `pro_paywall` (default off).
// Prices come from the store via RevenueCat offerings — never hardcoded.
import React from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, View } from 'react-native';
import { Redirect, Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { makeUseStyles, radius, spacing, typography, Text } from '@kc/ui';
import { useFeatureFlag } from '../src/hooks/useFeatureFlag';
import { useAuthStore } from '../src/store/authStore';
import { track } from '../src/lib/analytics';
import { rtlTextAlignStart } from '../src/lib/rtlTextAlignStart';
import { webTextRtl, webViewRtl } from '../src/lib/webRtlStyle';
import { getMarketplaceSupabaseClient } from '../src/services/marketplaceComposition';
import {
  getProPackages,
  manageSubscriptionUrl,
  purchaseProPackage,
  restoreProPurchases,
  type ProPackage,
} from '../src/services/purchases/revenuecat';

const PRO_KEY = ['is-pro'];

export default function ProPaywallScreen() {
  const { t } = useTranslation();
  const enabled = useFeatureFlag('pro_paywall');
  const styles = useScreenStyles();
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.session?.userId ?? null);
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  const proQuery = useQuery({
    queryKey: [...PRO_KEY, userId],
    enabled: enabled && !!userId,
    queryFn: async () => {
      const { data, error } = await getMarketplaceSupabaseClient().rpc('api_my_pro_status');
      if (error) throw error;
      return (data as { is_pro?: boolean } | null)?.is_pro === true;
    },
  });
  const isPro = proQuery.data === true;

  const packagesQuery = useQuery({
    queryKey: ['pro-packages'],
    enabled: enabled && proQuery.isSuccess && !isPro,
    queryFn: getProPackages,
  });

  React.useEffect(() => {
    if (enabled && proQuery.isSuccess && !isPro) track('paywall_viewed');
  }, [enabled, proQuery.isSuccess, isPro]);

  // The RevenueCat webhook flips the server entitlement; re-check after a purchase / restore.
  const refreshPro = React.useCallback(
    () => queryClient.invalidateQueries({ queryKey: PRO_KEY }),
    [queryClient],
  );

  const onBuy = React.useCallback(
    async (pkg: ProPackage) => {
      setBusy(true);
      track('purchase_started', { package: pkg.id });
      const result = await purchaseProPackage(pkg);
      setBusy(false);
      if (result === 'purchased') {
        track('purchase_completed', { package: pkg.id });
        await refreshPro();
      } else if (result === 'failed') {
        track('purchase_failed', { package: pkg.id });
        Alert.alert(t('general.errorTitle'), t('karma.proPurchaseFailed'));
      }
    },
    [refreshPro, t],
  );

  const onRestore = React.useCallback(async () => {
    setBusy(true);
    const restored = await restoreProPurchases();
    setBusy(false);
    if (restored) await refreshPro();
    else Alert.alert(t('karma.proTitle'), t('karma.proRestoreNone'));
  }, [refreshPro, t]);

  if (!enabled) return <Redirect href="/" />;

  const open = (url: string) => void Linking.openURL(url);
  const packages = packagesQuery.data ?? [];

  const renderPackageButtons = () => {
    if (packagesQuery.isLoading) return <ActivityIndicator accessibilityLabel={t('general.loading')} />;
    if (packages.length === 0) return <Text style={styles.note}>{t('karma.proUnavailable')}</Text>;
    return packages.map((pkg) => (
      <Pressable
        key={pkg.id}
        accessibilityRole="button"
        accessibilityState={{ disabled: busy }}
        disabled={busy}
        onPress={() => void onBuy(pkg)}
        style={[styles.button, busy && styles.disabled]}
      >
        <Text style={styles.buttonText}>{t('karma.proSubscribe', { price: pkg.priceString })}</Text>
      </Pressable>
    ));
  };

  const renderBody = () => {
    if (proQuery.isLoading) return <ActivityIndicator accessibilityLabel={t('general.loading')} />;
    if (isPro) {
      return (
        <View style={styles.card}>
          <Text style={styles.heading}>{t('karma.proActiveTitle')}</Text>
          <Text style={styles.body}>{t('karma.proActiveBody')}</Text>
          <Pressable accessibilityRole="link" onPress={() => open(manageSubscriptionUrl())} style={styles.link}>
            <Text style={styles.linkText}>{t('karma.proManage')}</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <>
        <Text style={styles.body}>{t('karma.proSubtitle')}</Text>
        <View style={styles.card}>
          <Text style={styles.body}>• {t('karma.proFeatureWhatsapp')}</Text>
          <Text style={styles.body}>• {t('karma.proFeatureAdmin')}</Text>
          <Text style={styles.note}>{t('karma.proFreeCore')}</Text>
        </View>

        {renderPackageButtons()}

        <Text style={styles.note}>{t('karma.proAutoRenew')}</Text>
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => void onRestore()} style={styles.link}>
          <Text style={styles.linkText}>{t('karma.proRestore')}</Text>
        </Pressable>
        <Pressable accessibilityRole="link" onPress={() => open(manageSubscriptionUrl())} style={styles.link}>
          <Text style={styles.linkText}>{t('karma.proManage')}</Text>
        </Pressable>
      </>
    );
  };

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: t('karma.proTitle') }} />
      <Text accessibilityRole="header" style={styles.title}>{t('karma.proTitle')}</Text>

      {renderBody()}

      <View style={styles.legalRow}>
        <Pressable accessibilityRole="link" onPress={() => router.push('/legal/terms')}>
          <Text style={styles.linkText}>{t('karma.proTerms')}</Text>
        </Pressable>
        <Pressable accessibilityRole="link" onPress={() => router.push('/legal/privacy')}>
          <Text style={styles.linkText}>{t('karma.proPrivacy')}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const useScreenStyles = makeUseStyles(({ colors }) => ({
  scroll: { flex: 1, backgroundColor: colors.background, ...webViewRtl },
  content: { padding: spacing.base, paddingBottom: spacing['3xl'], gap: spacing.md, ...webViewRtl },
  title: { ...typography.h2, ...typography.bold, color: colors.textPrimary, textAlign: rtlTextAlignStart, width: '100%', ...webTextRtl },
  heading: { ...typography.h3, color: colors.textPrimary, textAlign: rtlTextAlignStart, width: '100%', ...webTextRtl },
  body: { ...typography.body, color: colors.textPrimary, textAlign: rtlTextAlignStart, width: '100%', ...webTextRtl },
  note: { ...typography.caption, color: colors.textSecondary, textAlign: rtlTextAlignStart, width: '100%', ...webTextRtl },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.base, gap: spacing.sm, ...webViewRtl,
  },
  button: { backgroundColor: colors.primary, borderRadius: radius.sm, paddingVertical: spacing.md, alignItems: 'center' as const },
  disabled: { opacity: 0.5 },
  buttonText: { ...typography.button, color: colors.textInverse },
  link: { paddingVertical: spacing.sm, alignItems: 'center' as const },
  linkText: { ...typography.body, color: colors.primary },
  legalRow: { flexDirection: 'row' as const, justifyContent: 'center' as const, gap: spacing.lg, paddingTop: spacing.md },
}));
