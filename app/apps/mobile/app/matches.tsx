// Matching v2 — "Matches for you": automatic offer↔request pairs computed in Postgres.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { useDetailStackScreenOptions } from '../src/navigation/detailStackScreenOptions';
import { KcFlashList } from '../src/components/lists/KcFlashList';
import { SimpleRowListSkeleton } from '../src/components/skeletons/SimpleRowListSkeleton';
import { MatchSuggestionCard } from '../src/components/matching/MatchSuggestionCard';
import { useMyMatches, useRespondToMatch } from '../src/hooks/useMyMatches';
import { sortMatches, matchStateOf } from '../src/lib/matching';
import { trackCoreLoop } from '../src/lib/analyticsCoreLoop';
import { rtlTextAlignStart } from '../src/lib/rtlTextAlignStart';

export { RouteErrorBoundary as ErrorBoundary } from '../src/components/RouteErrorBoundary';

export default function MatchesScreen() {
  const { t } = useTranslation();
  const styles = useStyles();
  const detailOptions = useDetailStackScreenOptions();
  const query = useMyMatches(50);
  const respond = useRespondToMatch();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const shownRef = useRef(false);

  useEffect(() => {
    if (shownRef.current || query.isLoading || !query.data?.length) return;
    const open = query.data.filter((m) => matchStateOf(m) !== 'waiting');
    if (open.length === 0) return;
    shownRef.current = true;
    trackCoreLoop('match_shown', { count: open.length });
  }, [query.data, query.isLoading]);

  const onRespond = useCallback(
    (candidateId: string, response: 'accept' | 'decline') => {
      setBusyId(candidateId);
      setNotice(null);
      const match = query.data?.find((m) => m.candidateId === candidateId);
      respond.mutate(
        { candidateId, response },
        {
          onSuccess: (r) => {
            trackCoreLoop('match_feedback', { response, world: match?.worldSlug ?? 'unknown' });
            setNotice(t(response === 'decline' ? 'matches.declined' : r.mutual ? 'matches.mutual' : 'matches.accepted'));
          },
          onError: () => setNotice(t('matches.error')),
          onSettled: () => setBusyId(null),
        },
      );
    },
    [query.data, respond, t],
  );

  return (
    <>
      <Stack.Screen options={{ ...detailOptions, headerTitle: t('matches.title') }} />
      <KcFlashList
        data={sortMatches(query.data ?? [])}
        keyExtractor={(m) => m.candidateId}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View testID="matches-screen">
            <Text style={styles.intro}>{t('matches.intro')}</Text>
            {notice ? <Text style={styles.notice}>{notice}</Text> : null}
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.item}>
            <MatchSuggestionCard match={item} busy={busyId === item.candidateId} onRespond={onRespond} />
          </View>
        )}
        ListEmptyComponent={
          query.isLoading ? (
            <SimpleRowListSkeleton rows={4} rowHeight={140} />
          ) : (
            <Text style={styles.empty} testID="matches-empty">
              {query.isError ? t('matches.error') : t('matches.empty')}
            </Text>
          )
        }
      />
    </>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  list: { paddingHorizontal: spacing.base, paddingBottom: spacing.xl },
  intro: { ...typography.body, color: colors.textSecondary, marginVertical: spacing.md, textAlign: rtlTextAlignStart },
  notice: { ...typography.body, color: colors.primary, marginBottom: spacing.md, textAlign: rtlTextAlignStart },
  item: { marginBottom: spacing.md },
  empty: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xl },
}));
