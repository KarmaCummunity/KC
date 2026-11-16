import React, { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { ChallengeProgressResult, ChallengeSummary } from '@kc/domain';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { Card } from '../ui/Card';
import { TextField } from '../ui/TextField';
import { PrimaryButton, SecondaryButton } from '../ui/Buttons';
import { parseOptionalNumber } from '../../lib/challenges/challengeDraftFromForm';
import { rowDirectionStart } from '../../lib/rtlLayout';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';

interface ChallengeReportCardProps {
  readonly challenge: ChallengeSummary;
  readonly busy: boolean;
  /** Result of the last accepted report, shown as feedback under the form. */
  readonly lastResult: ChallengeProgressResult | null;
  readonly errorMessage: string | null;
  readonly onReport: (value: number, note: string | null) => void;
}

const useStyles = makeUseStyles(({ colors }) => ({
  heading: { ...typography.h3, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  buttons: { flexDirection: rowDirectionStart, gap: spacing.md },
  grow: { flex: 1 },
  feedback: { ...typography.bodySmall, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  error: { ...typography.bodySmall, color: colors.error, textAlign: rtlTextAlignStart },
}));

/** Files the viewer's report for the current cycle: yes / no buttons, or a number and a note. */
export function ChallengeReportCard({ challenge, busy, lastResult, errorMessage, onReport }: ChallengeReportCardProps) {
  const { t } = useTranslation();
  const styles = useStyles();
  const [valueText, setValueText] = useState('');
  const [note, setNote] = useState('');
  const trimmedNote = note.trim() || null;
  const isYesNo = challenge.measurement === 'yes_no';

  return (
    <Card style={{ gap: spacing.md }} testID="challenge-report-card">
      <Text style={styles.heading}>{t('challenges.detail.reportTitle')}</Text>
      {isYesNo ? (
        <View style={styles.buttons}>
          <View style={styles.grow}>
            <PrimaryButton
              label={t('challenges.detail.reportYes')}
              fullWidth
              disabled={busy}
              onPress={() => onReport(1, trimmedNote)}
              testID="challenge-report-yes"
            />
          </View>
          <View style={styles.grow}>
            <SecondaryButton
              label={t('challenges.detail.reportNo')}
              fullWidth
              disabled={busy}
              onPress={() => onReport(0, trimmedNote)}
              testID="challenge-report-no"
            />
          </View>
        </View>
      ) : (
        <>
          <TextField
            label={t('challenges.detail.reportValue')}
            value={valueText}
            onChangeText={setValueText}
            inputKind="decimal"
            testID="challenge-report-value"
          />
          <PrimaryButton
            label={t('challenges.detail.reportSave')}
            fullWidth
            disabled={busy}
            // An empty field is sent as NaN so the domain validator reports it instead of saving 0.
            onPress={() => onReport(parseOptionalNumber(valueText) ?? Number.NaN, trimmedNote)}
            testID="challenge-report-save"
          />
        </>
      )}
      <TextField label={t('challenges.detail.reportNote')} value={note} onChangeText={setNote} />
      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
      {lastResult ? <ReportFeedback result={lastResult} cadence={challenge.cadence} /> : null}
    </Card>
  );
}

function ReportFeedback({ result, cadence }: { readonly result: ChallengeProgressResult; readonly cadence: string }) {
  const { t } = useTranslation();
  const styles = useStyles();
  const parts = [
    result.goalMet ? t('challenges.detail.reportGoalMet') : t('challenges.detail.reportGoalMissed'),
    cadence === 'flexible' ? null : t('challenges.detail.reportStreak', { streak: result.currentStreak }),
    result.karmaPoints > 0 ? t('challenges.detail.reportKarma', { points: result.karmaPoints }) : null,
  ];
  return <Text style={styles.feedback}>{parts.filter(Boolean).join(' · ')}</Text>;
}
