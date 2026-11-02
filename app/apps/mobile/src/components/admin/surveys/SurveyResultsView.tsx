// app/apps/mobile/src/components/admin/surveys/SurveyResultsView.tsx
// FR-ADMIN-021 — survey detail: per-question stats + per-user answers; the Sean Ellis
// survey also shows its PMF score card (KC#1058).
import type { ReactElement } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { MirroredIcon } from '../../ui/MirroredIcon';
import type { AdminSurveyResults } from '@kc/domain';
import type { PmfSurveyReportView } from '@kc/application';
import { makeUseStyles, spacing, typography, useTheme, Text, iconSize } from '@kc/ui';
import { textAlignStart, rowDirectionStart } from '../../../lib/rtlLayout';
import { AdminListEmpty } from '../AdminListEmpty';
import { QuestionStatCard } from './QuestionStatCard';
import { RespondentCard } from './RespondentCard';
import { PmfReportCard } from './PmfReportCard';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';

export interface SurveyResultsViewProps {
  readonly results: AdminSurveyResults | null;
  readonly isLoading: boolean;
  /** PMF score state for the Sean Ellis survey; null for every other survey. */
  readonly pmf: { readonly view: PmfSurveyReportView | null; readonly isLoading: boolean } | null;
  readonly onBack: () => void;
}

export function SurveyResultsView({
  results,
  isLoading,
  pmf,
  onBack,
}: SurveyResultsViewProps): ReactElement {
  const styles = useStyles();
  const { colors } = useTheme();
  const L = useLocaleBundle();
  const t = L.admin.surveys;

  return (
    <View style={styles.root}>
      <Pressable onPress={onBack} accessibilityRole="button" style={styles.back}>
        <MirroredIcon name="arrow-back" size={iconSize.sm} color={colors.primary} />
        <Text style={styles.backText}>{t.backToList}</Text>
      </Pressable>

      {isLoading && !results ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : !results ? (
        <AdminListEmpty title={t.errorTitle} hint="" />
      ) : (
        <>
          <Text style={styles.heading}>{results.titleHe}</Text>
          <Text style={styles.subheading}>
            {t.overview.versionLabel(results.version)} · {t.overview.respondents(results.respondentCount)}
          </Text>

          {pmf ? <PmfReportCard view={pmf.view} isLoading={pmf.isLoading} /> : null}

          <Text style={styles.sectionTitle}>{t.stats.sectionTitle}</Text>
          <View style={styles.list}>
            {results.questions.map((q) => (
              <QuestionStatCard key={q.id} stat={q} />
            ))}
          </View>

          <Text style={styles.sectionTitle}>{t.respondents.sectionTitle}</Text>
          {results.respondents.length === 0 ? (
            <AdminListEmpty title={t.respondents.emptyTitle} hint="" />
          ) : (
            <View style={styles.list}>
              {results.respondents.map((r) => (
                <RespondentCard key={r.userId} respondent={r} questions={results.questions} />
              ))}
            </View>
          )}
        </>
      )}
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  root: { gap: spacing.md },
  back: { flexDirection: rowDirectionStart, alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xs },
  backText: { fontSize: typography.body.fontSize, ...typography.bold, color: colors.primary },
  center: { paddingVertical: spacing['2xl'], alignItems: 'center' },
  heading: { fontSize: typography.h2.fontSize, ...typography.extraBold, color: colors.textPrimary, textAlign: textAlignStart() },
  subheading: { fontSize: typography.bodySmall.fontSize, color: colors.textSecondary, textAlign: textAlignStart() },
  sectionTitle: {
    fontSize: typography.body.fontSize, ...typography.extraBold, color: colors.textSecondary,
    textAlign: textAlignStart(), marginTop: spacing.sm,
  },
  list: { gap: spacing.md },
}));
