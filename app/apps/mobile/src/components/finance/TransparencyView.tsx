// FR-FIN-022 — presentational public transparency card. Renders only the blocks the server
// sent (each is null when its toggle is off), so the privacy controls are enforced server-side
// and this component never has to second-guess them.
import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { OrgTransparency } from '@kc/domain';
import { makeUseStyles, radius, spacing, Text, typography } from '@kc/ui';
import { formatMoney } from '../../lib/formatMoney';
import { rowDirectionStart } from '../../lib/rtlLayout';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { MonthlyBars, ShareBar } from './TransparencyBars';

/** True when at least one block has something to show (an enabled toggle can still be empty). */
export function hasTransparencyContent(d: OrgTransparency): boolean {
  return (
    d.totals !== null ||
    d.donationsCount !== null ||
    d.programRatio !== null ||
    (d.byCategory?.length ?? 0) > 0 ||
    (d.monthly?.length ?? 0) > 0
  );
}

export function TransparencyView({ data, style }: { data: OrgTransparency; style?: StyleProp<ViewStyle> }) {
  const { t, i18n } = useTranslation();
  const styles = useStyles();
  const locale = i18n.language.startsWith('he') ? 'he-IL' : 'en-IL';
  const money = (cents: number) => formatMoney(cents, data.currency, locale);
  const categoryLabel = (key: string) =>
    t(`transparency.category.${key}`, { defaultValue: t('transparency.category.other_out') });
  const categoryTotal = (data.byCategory ?? []).reduce((sum, c) => sum + c.cents, 0);

  return (
    <View style={[styles.card, style]} testID="org-transparency">
      <Text style={styles.title}>{t('transparency.title')}</Text>
      <Text style={styles.subtitle}>{t('transparency.subtitle')}</Text>

      {data.totals ? (
        <View style={styles.tiles}>
          <Tile label={t('transparency.income')} value={money(data.totals.incomeCents)} tone="success" />
          <Tile label={t('transparency.expense')} value={money(data.totals.expenseCents)} tone="error" />
          <Tile
            label={t('transparency.net')}
            value={money(data.totals.netCents)}
            tone={data.totals.netCents >= 0 ? 'success' : 'error'}
          />
        </View>
      ) : null}

      {data.donationsCount !== null ? (
        <View style={styles.inline}>
          <Text style={styles.inlineLabel}>{t('transparency.donationsCount')}</Text>
          <Text style={styles.inlineValue}>{data.donationsCount}</Text>
        </View>
      ) : null}

      {data.programRatio !== null ? (
        <View style={styles.block}>
          <Text style={styles.blockTitle}>{t('transparency.programRatioTitle')}</Text>
          <ShareBar ratio={data.programRatio} tone="success" />
          <Text style={styles.hint}>
            {t('transparency.programRatioBody', { percent: Math.round(data.programRatio * 100) })}
          </Text>
        </View>
      ) : null}

      {data.byCategory && data.byCategory.length > 0 ? (
        <View style={styles.block}>
          <Text style={styles.blockTitle}>{t('transparency.categoriesTitle')}</Text>
          {data.byCategory.map((c) => (
            <View key={c.key} style={styles.catRow}>
              <View style={styles.inline}>
                <Text style={styles.inlineLabel}>{categoryLabel(c.key)}</Text>
                <Text style={styles.inlineValue}>{money(c.cents)}</Text>
              </View>
              <ShareBar ratio={categoryTotal > 0 ? c.cents / categoryTotal : 0} />
            </View>
          ))}
        </View>
      ) : null}

      {data.monthly && data.monthly.length > 0 ? (
        <View style={styles.block}>
          <Text style={styles.blockTitle}>{t('transparency.monthlyTitle')}</Text>
          <MonthlyBars months={data.monthly} a11yLabel={t('transparency.monthlyA11y')} />
          <View style={styles.legend}>
            <Legend color="success" label={t('transparency.income')} />
            <Legend color="error" label={t('transparency.expense')} />
          </View>
        </View>
      ) : null}

      {data.lastEntryAt ? (
        <Text style={styles.footnote}>
          {t('transparency.updatedAt', { date: data.lastEntryAt.toLocaleDateString(locale) })}
        </Text>
      ) : null}
    </View>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone: 'success' | 'error' }) {
  const styles = useStyles();
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={[styles.tileValue, tone === 'success' ? styles.success : styles.error]}>{value}</Text>
    </View>
  );
}

function Legend({ color, label }: { color: 'success' | 'error'; label: string }) {
  const styles = useStyles();
  return (
    <View style={styles.legendItem}>
      <View style={[styles.dot, color === 'success' ? styles.dotSuccess : styles.dotError]} />
      <Text style={styles.hint}>{label}</Text>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  card: {
    backgroundColor: colors.primarySurface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.primaryLight,
    padding: spacing.base,
    gap: spacing.md,
  },
  title: { ...typography.h4, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  subtitle: { ...typography.bodySmall, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  tiles: { flexDirection: rowDirectionStart, gap: spacing.sm },
  tile: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.sm,
    gap: spacing.xs,
    alignItems: 'center',
  },
  tileLabel: { ...typography.caption, color: colors.textSecondary },
  tileValue: { ...typography.h4 },
  success: { color: colors.success },
  error: { color: colors.error },
  inline: { flexDirection: rowDirectionStart, justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  inlineLabel: { ...typography.body, color: colors.textSecondary, flex: 1, textAlign: rtlTextAlignStart },
  inlineValue: { ...typography.h4, color: colors.textPrimary },
  block: { gap: spacing.sm },
  blockTitle: { ...typography.label, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  hint: { ...typography.caption, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  catRow: { gap: spacing.xs },
  legend: { flexDirection: rowDirectionStart, gap: spacing.base },
  legendItem: { flexDirection: rowDirectionStart, alignItems: 'center', gap: spacing.xs },
  dot: { width: 8, height: 8, borderRadius: radius.full },
  dotSuccess: { backgroundColor: colors.success },
  dotError: { backgroundColor: colors.error },
  footnote: { ...typography.caption, color: colors.textSecondary, textAlign: rtlTextAlignStart },
}));
