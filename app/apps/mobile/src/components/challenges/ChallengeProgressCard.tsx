import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { ChallengeSummary } from '@kc/domain';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { Card } from '../ui/Card';
import { Chip } from '../ui/Chip';
import { rowDirectionStart } from '../../lib/rtlLayout';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';

const useStyles = makeUseStyles(({ colors }) => ({
  stats: { flexDirection: rowDirectionStart, justifyContent: 'space-between', gap: spacing.md },
  stat: { flex: 1, alignItems: 'center' },
  value: { ...typography.h2, color: colors.textPrimary },
  label: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' },
  heading: { ...typography.h3, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  note: { ...typography.caption, color: colors.textSecondary, textAlign: rtlTextAlignStart },
}));

/** The viewer's own streaks and cycle count in a challenge they joined. */
export function ChallengeProgressCard({ challenge }: { readonly challenge: ChallengeSummary }) {
  const { t } = useTranslation();
  const styles = useStyles();
  const hasStreak = challenge.cadence !== 'flexible';
  const cyclesLabel = challenge.targetCycles
    ? `${challenge.mySuccessfulCycles} ${t('challenges.detail.target', { target: challenge.targetCycles })}`
    : String(challenge.mySuccessfulCycles);
  return (
    <Card style={{ gap: spacing.md }} testID="challenge-progress-card">
      <Text style={styles.heading}>{t('challenges.detail.myProgress')}</Text>
      <View style={styles.stats}>
        {hasStreak ? (
          <>
            <Stat value={String(challenge.myCurrentStreak)} label={t('challenges.detail.currentStreak')} />
            <Stat value={String(challenge.myBestStreak)} label={t('challenges.detail.bestStreak')} />
          </>
        ) : null}
        <Stat value={cyclesLabel} label={t('challenges.detail.cycles')} />
      </View>
      {hasStreak ? null : <Text style={styles.note}>{t('challenges.detail.noStreak')}</Text>}
      {challenge.myCompleted ? (
        <Chip variant="tag" tone="success" label={t('challenges.detail.completed')} icon="trophy-outline" />
      ) : null}
    </Card>
  );
}

function Stat({ value, label }: { readonly value: string; readonly label: string }) {
  const styles = useStyles();
  return (
    <View style={styles.stat}>
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}
