// app/apps/mobile/src/components/admin/surveys/PmfReportCard.tsx
// FR-ADMIN-021 / KC#1058 — Sean Ellis PMF score: share of "very disappointed" among active
// respondents with its 95% margin of error, the 40% benchmark, sample size, and a 7-day
// retention cross-check per answer option.
import type { ReactElement } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { PMF_MIN_RELIABLE_SAMPLE, type PmfOptionSummary } from '@kc/domain';
import type { PmfSurveyReportView } from '@kc/application';
import { makeUseStyles, radius, spacing, typography, useTheme, Text } from '@kc/ui';
import { textAlignStart, rowDirectionStart } from '../../../lib/rtlLayout';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';
import { formatPmfPercent } from './formatPmfPercent';

export interface PmfReportCardProps {
  readonly view: PmfSurveyReportView | null;
  readonly isLoading: boolean;
}

export function PmfReportCard({ view, isLoading }: PmfReportCardProps): ReactElement {
  const styles = useStyles();
  const { colors } = useTheme();
  const t = useLocaleBundle().admin.surveys.pmf;

  if (isLoading) {
    return <View style={styles.card}><ActivityIndicator color={colors.primary} /></View>;
  }
  if (!view) {
    return <View style={styles.card}><Text style={styles.muted}>{t.errorTitle}</Text></View>;
  }

  const { report, summary } = view;
  return (
    <View style={styles.card} testID="admin-pmf-report">
      <Text style={styles.title}>{t.sectionTitle}</Text>

      {summary.sampleSize === 0 ? (
        <Text style={styles.muted}>{t.emptyTitle}</Text>
      ) : (
        <>
          <View style={styles.scoreRow}>
            <Text style={styles.score}>{formatPmfPercent(summary.veryDisappointedShare)}</Text>
            <View style={styles.scoreText}>
              <Text style={styles.caption}>{t.scoreCaption}</Text>
              <Text style={styles.caption}>{t.marginOfError(formatPmfPercent(summary.marginOfError95, 1))}</Text>
            </View>
            <View style={[styles.badge, summary.meetsBenchmark ? styles.badgeGood : styles.badgeBad]}>
              <Text style={styles.badgeText}>
                {summary.meetsBenchmark ? t.aboveBenchmark : t.belowBenchmark}
              </Text>
            </View>
          </View>
          <Text style={styles.muted}>{t.benchmark}</Text>
          {summary.isReliableSample ? null : (
            <Text style={styles.warning}>{t.smallSample(PMF_MIN_RELIABLE_SAMPLE)}</Text>
          )}
        </>
      )}

      <Text style={styles.muted}>{t.sample(summary.sampleSize, report.respondentsTotal)}</Text>
      <Text style={styles.hint}>{t.qualifiedHint(report.minActiveDays14d)}</Text>

      <View style={styles.options}>
        {summary.options.map((option) => (
          <OptionRow key={option.key} option={option} />
        ))}
      </View>
      <Text style={styles.hint}>{t.retentionHint}</Text>
    </View>
  );
}

/** One answer option: its share of the sample and how many came back a week later. */
function OptionRow({ option }: { readonly option: PmfOptionSummary }): ReactElement {
  const styles = useStyles();
  const t = useLocaleBundle().admin.surveys.pmf;
  const width = `${Math.round((option.share ?? 0) * 100)}%` as const;

  return (
    <View style={styles.option}>
      <View style={styles.optionTop}>
        <Text style={styles.optionLabel} numberOfLines={2}>{option.labelHe}</Text>
        <Text style={styles.optionValue}>{t.optionShare(formatPmfPercent(option.share), option.count)}</Text>
      </View>
      <View style={styles.track}><View style={[styles.fill, { width }]} /></View>
      <Text style={styles.hint}>
        {option.retentionRate === null
          ? t.retentionPending
          : t.retention(formatPmfPercent(option.retentionRate), option.retained, option.retentionBase)}
      </Text>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.base,
    gap: spacing.sm,
  },
  title: { fontSize: typography.body.fontSize, ...typography.extraBold, color: colors.textPrimary, textAlign: textAlignStart() },
  scoreRow: { flexDirection: rowDirectionStart, alignItems: 'center', gap: spacing.md },
  score: { fontSize: typography.h1.fontSize, ...typography.extraBold, color: colors.primaryDark },
  scoreText: { flex: 1, gap: spacing.xs },
  caption: { fontSize: typography.bodySmall.fontSize, ...typography.semiBold, color: colors.textSecondary, textAlign: textAlignStart() },
  badge: { borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  badgeGood: { backgroundColor: colors.primarySurface },
  badgeBad: { backgroundColor: colors.secondaryLight },
  badgeText: { fontSize: typography.caption.fontSize, ...typography.extraBold, color: colors.textPrimary },
  muted: { fontSize: typography.bodySmall.fontSize, color: colors.textSecondary, textAlign: textAlignStart() },
  warning: { fontSize: typography.bodySmall.fontSize, ...typography.bold, color: colors.error, textAlign: textAlignStart() },
  hint: { fontSize: typography.caption.fontSize, color: colors.textDisabled, textAlign: textAlignStart() },
  options: { gap: spacing.sm, marginTop: spacing.xs },
  option: { gap: spacing.xs },
  optionTop: { flexDirection: rowDirectionStart, alignItems: 'center', gap: spacing.sm },
  optionLabel: { flex: 1, fontSize: typography.bodySmall.fontSize, ...typography.bold, color: colors.textPrimary, textAlign: textAlignStart() },
  optionValue: { fontSize: typography.bodySmall.fontSize, ...typography.bold, color: colors.textSecondary },
  track: { height: 8, borderRadius: radius.xs, backgroundColor: colors.skeleton, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.xs, backgroundColor: colors.primary },
}));
