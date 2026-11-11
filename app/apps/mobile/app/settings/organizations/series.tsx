// FR-POST-024 — "My recurring events": every series the member runs, with pause / resume, a
// change of times, cancelling one date and ending the series. The server keeps the dates in
// step: a pause drops the upcoming dates nobody registered for, an end cancels them all and
// tells each registrant.
import React, { useState } from 'react';
import { Alert, ScrollView } from 'react-native';
import { Stack } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { Screen } from '../../../src/components/ui';
import { PostSeriesRow } from '../../../src/components/series/PostSeriesRow';
import { useShellStackScreenOptions } from '../../../src/navigation/shellStackScreenOptions';
import { MY_POST_SERIES_QUERY_KEY, postSeriesUseCases } from '../../../src/services/postSeriesComposition';
import { postSeriesErrorKey } from '../../../src/lib/postSeriesError';
import { hapticSuccess } from '../../../src/lib/haptics';
import { webTextRtl } from '../../../src/lib/webRtlStyle';
export { RouteErrorBoundary as ErrorBoundary } from '../../../src/components/RouteErrorBoundary';

export default function MyPostSeriesScreen() {
  const shellStackScreenOptions = useShellStackScreenOptions();
  const { t } = useTranslation();
  const styles = useStyles();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const series = useQuery({ queryKey: MY_POST_SERIES_QUERY_KEY, queryFn: () => postSeriesUseCases.listMine().execute() });
  const list = series.data ?? [];

  // Runs one series action: busy state, success haptic, cache refresh, friendly error copy.
  const run = async (action: () => Promise<unknown>, successKey?: string) => {
    setBusy(true);
    try {
      await action();
      hapticSuccess();
      // The series list and its dates, and every list or post that shows one of them.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: MY_POST_SERIES_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ['post-series-occurrences'] }),
        queryClient.invalidateQueries({ queryKey: ['marketplace'] }),
        queryClient.invalidateQueries({ queryKey: ['feed'] }),
      ]);
      if (successKey) Alert.alert(t(successKey));
    } catch (error) {
      Alert.alert(t(postSeriesErrorKey(error) ?? 'postSeries.errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ ...shellStackScreenOptions, headerTitle: t('postSeries.mine') }} />
      <Screen>
        <ScrollView contentContainerStyle={styles.list} testID="post-series-list">
          <Text style={[styles.intro, webTextRtl]}>{t('postSeries.intro')}</Text>
          {list.map((item) => <PostSeriesRow key={item.id} series={item} busy={busy} run={run} />)}
          {!series.isLoading && list.length === 0 ? (
            <Text style={[styles.empty, webTextRtl]}>{t(series.isError ? 'postSeries.error' : 'postSeries.empty')}</Text>
          ) : null}
        </ScrollView>
      </Screen>
    </>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  list: { paddingVertical: spacing.md, gap: spacing.sm },
  intro: { ...typography.body, color: colors.textSecondary, paddingHorizontal: spacing.lg },
  empty: { ...typography.body, color: colors.textSecondary, padding: spacing.lg, textAlign: 'center' as const },
}));
