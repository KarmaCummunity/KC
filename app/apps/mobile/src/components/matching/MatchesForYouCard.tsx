// Donations hub summary: top "Matches for you" (matching v2) with a link to the full list.
import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { useMyMatches } from '../../hooks/useMyMatches';
import { Card } from '../ui/Card';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { matchStateOf, scorePercent } from '../../lib/matching';

const useStyles = makeUseStyles(({ colors }) => ({
  wrap: { width: '100%', marginBottom: spacing.lg },
  title: { ...typography.h3, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  row: { ...typography.body, color: colors.textPrimary, marginTop: spacing.sm, textAlign: rtlTextAlignStart },
  more: { ...typography.caption, color: colors.primary, marginTop: spacing.sm, textAlign: rtlTextAlignStart },
}));

export function MatchesForYouCard() {
  const { t } = useTranslation();
  const styles = useStyles();
  const router = useRouter();
  const { data } = useMyMatches(20);
  const open = (data ?? []).filter((m) => matchStateOf(m) !== 'waiting');
  if (open.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <Card onPress={() => router.push('/matches')} testID="matches-for-you-card"
            accessibilityLabel={t('matches.title')}>
        <Text style={styles.title}>{t('matches.titleWithCount', { count: open.length })}</Text>
        {open.slice(0, 3).map((m) => (
          <Text key={m.candidateId} style={styles.row} numberOfLines={1}>
            {m.otherListingTitle} · {t('matches.score', { pct: scorePercent(m.score) })}
          </Text>
        ))}
        <Text style={styles.more}>{t('matches.seeAll')}</Text>
      </Card>
    </View>
  );
}
