// "Recommended for you" — matching v2 strip in hub, home feed, and per-world feeds.
import React, { useCallback, useState } from 'react';
import { View, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { iconSize, makeUseStyles, spacing, typography, useTheme, Text } from '@kc/ui';
import { useOpenMatches } from '../../hooks/useOpenMatches';
import { useRespondToMatch } from '../../hooks/useMyMatches';
import { rowDirectionStart } from '../../lib/rtlLayout';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { MatchFeedRow } from './MatchFeedRow';

type Props = {
  readonly worldSlug?: string;
  readonly maxVisible?: number;
  /** `hub` adds outer margin for donations; `feed` sits inside feed headers. */
  readonly variant?: 'hub' | 'feed';
  /** Stable key for repeated inline strips in the same list (avoids hook/state collisions). */
  readonly inlineKey?: string;
};

export function MatchesFeedSection({ worldSlug, maxVisible = 3, variant = 'feed', inlineKey }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const { open, isLoading } = useOpenMatches(worldSlug, 30);
  const respond = useRespondToMatch();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const onRespond = useCallback(
    (candidateId: string, response: 'accept' | 'decline') => {
      setBusyId(candidateId);
      setNotice(null);
      respond.mutate(
        { candidateId, response },
        {
          onSuccess: (r) => {
            setNotice(
              t(response === 'decline' ? 'matches.declined' : r.mutual ? 'matches.mutual' : 'matches.accepted'),
            );
          },
          onError: () => setNotice(t('matches.error')),
          onSettled: () => setBusyId(null),
        },
      );
    },
    [respond, t],
  );

  if (isLoading || open.length === 0) return null;

  const visible = open.slice(0, maxVisible);
  const wrapStyle = variant === 'hub' ? styles.hubWrap : styles.feedWrap;

  return (
    <View style={wrapStyle}>
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <View style={styles.titleRow}>
            <Ionicons name="sparkles" size={iconSize.lg} color={colors.primary} />
            <Text style={styles.title}>
              {worldSlug
                ? t('matches.feedSectionTitleWorld', {
                    world: t(`marketplace.world.${worldSlug}`, { defaultValue: worldSlug }),
                  })
                : t('matches.feedSectionTitle')}
            </Text>
          </View>
          <Text style={styles.subtitle}>{t('matches.feedSectionSubtitle')}</Text>
        </View>
        <TouchableOpacity
          onPress={() => router.push('/matches')}
          accessibilityRole="button"
          accessibilityLabel={t('matches.seeAll')}
          testID="matches-feed-see-all"
        >
          <Text style={styles.seeAll}>{t('matches.seeAll')}</Text>
        </TouchableOpacity>
      </View>
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      <View
        style={styles.list}
        testID={inlineKey ?? (worldSlug ? `matches-feed-${worldSlug}` : 'matches-feed-home')}
      >
        {visible.map((m) => (
          <MatchFeedRow key={m.candidateId} match={m} busy={busyId === m.candidateId} onRespond={onRespond} />
        ))}
      </View>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  hubWrap: { width: '100%', marginBottom: spacing.lg },
  feedWrap: { width: '100%', marginBottom: spacing.md, paddingHorizontal: spacing.lg },
  headerRow: {
    flexDirection: rowDirectionStart,
    alignItems: 'flex-start' as const,
    justifyContent: 'space-between' as const,
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  headerText: { flex: 1, gap: spacing.xs },
  titleRow: { flexDirection: rowDirectionStart, alignItems: 'center' as const, gap: spacing.xs },
  title: { ...typography.h3, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  subtitle: { ...typography.caption, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  seeAll: { ...typography.caption, ...typography.bold, color: colors.primary },
  notice: {
    ...typography.caption,
    color: colors.primary,
    marginBottom: spacing.sm,
    textAlign: rtlTextAlignStart,
  },
  list: { gap: spacing.sm },
}));
