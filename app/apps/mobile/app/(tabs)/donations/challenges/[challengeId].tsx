// Mapped to spec: docs/spec/10_challenges.md — one challenge: join / leave / end, report the
// current cycle, my streaks and history, and the participants' standing (no karma shown).
import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChallengeProgressResult } from '@kc/domain';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { Screen } from '../../../../src/components/ui/Screen';
import { Chip } from '../../../../src/components/ui/Chip';
import { PrimaryButton, GhostButton } from '../../../../src/components/ui/Buttons';
import { ChallengeProgressCard } from '../../../../src/components/challenges/ChallengeProgressCard';
import { ChallengeReportCard } from '../../../../src/components/challenges/ChallengeReportCard';
import {
  ChallengeEntriesCard,
  ChallengeLeaderboardCard,
} from '../../../../src/components/challenges/ChallengeHistoryAndLeaderboard';
import { CHALLENGES_QUERY_KEY, challengeUseCases } from '../../../../src/services/challengeComposition';
import { challengeErrorMessage } from '../../../../src/lib/challenges/challengeErrorMessage';
import { challengeGoalLabel } from '../../../../src/lib/challenges/challengeLabels';
import { confirmAction } from '../../../../src/services/platformConfirm';
import { useAuthStore } from '../../../../src/store/authStore';
import { useShellTabBarScrollInset } from '../../../../src/navigation/useShellTabBarVisibility';
import { rowDirectionStart } from '../../../../src/lib/rtlLayout';
import { rtlTextAlignStart } from '../../../../src/lib/rtlTextAlignStart';

const useStyles = makeUseStyles(({ colors }) => ({
  title: { ...typography.h1, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  body: { ...typography.body, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  meta: { ...typography.bodySmall, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  chips: { flexDirection: rowDirectionStart, flexWrap: 'wrap', gap: spacing.sm },
  error: { ...typography.bodySmall, color: colors.error, textAlign: rtlTextAlignStart },
}));

export default function ChallengeDetailScreen() {
  const { challengeId } = useLocalSearchParams<{ challengeId: string }>();
  const { t } = useTranslation();
  const styles = useStyles();
  const router = useRouter();
  const inset = useShellTabBarScrollInset();
  const myUserId = useAuthStore((state) => state.session?.userId);
  const queryClient = useQueryClient();
  const [lastResult, setLastResult] = useState<ChallengeProgressResult | null>(null);

  const challenge = useQuery({
    queryKey: [CHALLENGES_QUERY_KEY, 'detail', challengeId],
    queryFn: () => challengeUseCases.get().execute(challengeId),
  });
  const joined = challenge.data?.joined ?? false;
  const entries = useQuery({
    queryKey: [CHALLENGES_QUERY_KEY, 'entries', challengeId],
    queryFn: () => challengeUseCases.listEntries().execute(challengeId, 14),
    enabled: joined,
  });
  const leaderboard = useQuery({
    queryKey: [CHALLENGES_QUERY_KEY, 'leaderboard', challengeId],
    queryFn: () => challengeUseCases.listLeaderboard().execute(challengeId),
    enabled: joined && challenge.data?.scope === 'community',
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: [CHALLENGES_QUERY_KEY] });
  const report = useMutation({
    mutationFn: (input: { value: number; note: string | null }) =>
      challengeUseCases.report().execute({
        challengeId,
        measurement: challenge.data!.measurement,
        value: input.value,
        note: input.note,
        reportDate: null,
      }),
    onSuccess: async (result) => {
      setLastResult(result);
      await refresh();
    },
  });
  const membership = useMutation({
    mutationFn: (action: 'join' | 'leave' | 'end') => challengeUseCases[action]().execute(challengeId),
    onSuccess: async (_data, action) => {
      await refresh();
      if (action === 'leave') router.back();
    },
  });

  const confirmThen = async (action: 'leave' | 'end') => {
    const ok = await confirmAction(t(`challenges.detail.${action}Title`), t(`challenges.detail.${action}Body`), {
      confirmLabel: t(`challenges.detail.${action}`),
      destructive: true,
    });
    if (ok) membership.mutate(action);
  };

  const data = challenge.data;
  if (!data) {
    return (
      <Screen blobs="content">
        <Text style={[styles.meta, { padding: spacing.lg }]}>
          {challenge.isLoading ? t('challenges.loading') : t('challenges.detail.notFound')}
        </Text>
      </Screen>
    );
  }

  const isCreator = data.creatorId === myUserId;
  const goal = challengeGoalLabel(t, data);
  const active = data.status === 'active';

  return (
    <Screen blobs="content">
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: inset }}>
        <Text style={styles.title}>{data.title}</Text>
        <View style={styles.chips}>
          <Chip variant="tag" label={t(`challenges.scope.${data.scope}`)} />
          <Chip variant="tag" label={t(`challenges.cadence.${data.cadence}`)} />
          <Chip variant="tag" label={t(`challenges.measurement.${data.measurement}`)} />
          {data.difficulty ? <Chip variant="tag" label={t(`challenges.difficulty.${data.difficulty}`)} /> : null}
          {active ? null : <Chip variant="tag" tone="warning" label={t('challenges.endedTag')} />}
        </View>
        {data.description ? <Text style={styles.body}>{data.description}</Text> : null}
        <Text style={styles.meta}>
          {[goal, t('challenges.participants', { n: data.participantsCount }), t('challenges.detail.by', { name: data.creatorDisplayName })]
            .filter(Boolean)
            .join(' · ')}
        </Text>
        {membership.error ? <Text style={styles.error}>{challengeErrorMessage(t, membership.error)}</Text> : null}

        {joined ? <ChallengeProgressCard challenge={data} /> : null}
        {joined && active ? (
          <ChallengeReportCard
            challenge={data}
            busy={report.isPending}
            lastResult={lastResult}
            errorMessage={report.error ? challengeErrorMessage(t, report.error) : null}
            onReport={(value, note) => report.mutate({ value, note })}
          />
        ) : null}
        {joined ? <ChallengeEntriesCard entries={entries.data ?? []} /> : null}
        {leaderboard.data && leaderboard.data.length > 0 ? <ChallengeLeaderboardCard rows={leaderboard.data} /> : null}

        {!joined && active ? (
          <PrimaryButton
            label={t('challenges.detail.join')}
            fullWidth
            disabled={membership.isPending}
            onPress={() => membership.mutate('join')}
            testID="challenge-join"
          />
        ) : null}
        {joined && !isCreator ? (
          <GhostButton label={t('challenges.detail.leave')} fullWidth onPress={() => void confirmThen('leave')} />
        ) : null}
        {isCreator && active ? (
          <GhostButton label={t('challenges.detail.end')} fullWidth onPress={() => void confirmThen('end')} />
        ) : null}
      </ScrollView>
    </Screen>
  );
}
