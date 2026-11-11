// #850 — in-app donations to verified nonprofits (roadmap phase 2). Runs on the
// sandbox provider only, so the Money hub renders it solely when the
// `money_in_app_org_payments` flag is on (FR-DONATE-011 AC8).
import React from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { makeUseStyles, spacing, radius, typography, Text } from '@kc/ui';
import type { VerifiedNonprofitRow } from '@kc/domain';
import { paymentsUseCases } from '../../services/paymentsComposition';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { listOrEmpty } from '../../lib/backendAvailability';

const useStyles = makeUseStyles(({ colors }) => ({
  section: { gap: spacing.sm },
  title: { ...typography.h3, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  body: { ...typography.body, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  links: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.md },
  link: { ...typography.body, color: colors.primary, ...typography.semiBold },
  row: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceRaised },
  rowTitle: { ...typography.bodyLarge, color: colors.textPrimary },
  rowMeta: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  sandbox: { padding: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.secondaryLight },
  sandboxText: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' as const },
}));

function NonprofitRow({ item }: { readonly item: VerifiedNonprofitRow }) {
  const { i18n } = useTranslation();
  const router = useRouter();
  const styles = useStyles();
  const tagline = i18n.language.startsWith('he') ? item.taglineHe : item.taglineEn;
  return (
    <Pressable
      style={styles.row}
      accessibilityRole="button"
      onPress={() => router.push(`/(tabs)/donations/money/nonprofit/${item.slug}`)}
    >
      <Text style={styles.rowTitle}>{item.name}</Text>
      {tagline ? <Text style={styles.rowMeta}>{tagline}</Text> : null}
    </Pressable>
  );
}

export function VerifiedNonprofitsSection() {
  const { t } = useTranslation();
  const router = useRouter();
  const styles = useStyles();
  const nonprofits = useQuery({
    queryKey: ['money', 'nonprofits'],
    queryFn: () => listOrEmpty(() => paymentsUseCases.listNonprofits().execute(50)),
    staleTime: 60_000,
  });
  const rows = nonprofits.data ?? [];

  return (
    <View style={styles.section} testID="verified-nonprofits-section">
      <Text style={styles.title} accessibilityRole="header">{t('moneyPayments.nonprofitsSection')}</Text>
      <Text style={styles.body}>{t('moneyPayments.hubIntro')}</Text>
      <View style={styles.sandbox}>
        <Text style={styles.sandboxText}>{t('moneyPayments.sandboxBanner')}</Text>
      </View>
      <View style={styles.links}>
        <Pressable onPress={() => router.push('/(tabs)/donations/money/history')}>
          <Text style={styles.link}>{t('moneyPayments.historyLink')}</Text>
        </Pressable>
        <Pressable onPress={() => router.push('/(tabs)/donations/money/standing-orders')}>
          <Text style={styles.link}>{t('moneyPayments.standingLink')}</Text>
        </Pressable>
      </View>
      {rows.length === 0 ? (
        <Text style={styles.body}>
          {nonprofits.isLoading ? t('moneyPayments.loading') : t('moneyPayments.noNonprofits')}
        </Text>
      ) : (
        rows.map((item) => <NonprofitRow key={item.orgId} item={item} />)
      )}
    </View>
  );
}
