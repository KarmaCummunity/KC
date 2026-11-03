import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { ChallengeEntry, ChallengeLeaderboardRow } from '@kc/domain';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { Card } from '../ui/Card';
import { rowDirectionStart } from '../../lib/rtlLayout';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';

const useStyles = makeUseStyles(({ colors }) => ({
  heading: { ...typography.h3, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  row: { flexDirection: rowDirectionStart, justifyContent: 'space-between', gap: spacing.md },
  primary: { ...typography.body, color: colors.textPrimary, flexShrink: 1, textAlign: rtlTextAlignStart },
  secondary: { ...typography.bodySmall, color: colors.textSecondary },
  muted: { ...typography.caption, color: colors.textSecondary, textAlign: rtlTextAlignStart },
}));

/** The viewer's own reports, newest cycle first. */
export function ChallengeEntriesCard({ entries }: { readonly entries: readonly ChallengeEntry[] }) {
  const { t } = useTranslation();
  const styles = useStyles();
  return (
    <Card style={{ gap: spacing.sm }} testID="challenge-entries-card">
      <Text style={styles.heading}>{t('challenges.detail.history')}</Text>
      {entries.length === 0 ? <Text style={styles.muted}>{t('challenges.detail.historyEmpty')}</Text> : null}
      {entries.map((entry) => (
        <View key={entry.cycleStart} style={styles.row}>
          <Text style={styles.primary}>{entry.cycleStart}</Text>
          <Text style={styles.secondary}>
            {entry.value}
            {entry.goalMet ? ' ✓' : ''}
          </Text>
        </View>
      ))}
    </Card>
  );
}

/** Participants ranked by streak and successful cycles; karma is never shown (10). */
export function ChallengeLeaderboardCard({ rows }: { readonly rows: readonly ChallengeLeaderboardRow[] }) {
  const { t } = useTranslation();
  const styles = useStyles();
  return (
    <Card style={{ gap: spacing.sm }} testID="challenge-leaderboard-card">
      <Text style={styles.heading}>{t('challenges.detail.leaderboard')}</Text>
      {rows.map((row, index) => (
        <View key={row.userId} style={styles.row}>
          <Text style={styles.primary}>
            {index + 1}. {row.isMe ? t('challenges.detail.you') : row.displayName}
          </Text>
          <Text style={styles.secondary}>
            {t('challenges.detail.streakShort', { n: row.currentStreak })} · {row.successfulCycles}
          </Text>
        </View>
      ))}
      <Text style={styles.muted}>{t('challenges.detail.leaderboardNote')}</Text>
    </Card>
  );
}
