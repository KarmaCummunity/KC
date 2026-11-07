import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type {
  ChallengeEntry,
  ChallengeLeaderboardRow,
  ChallengeProgressResult,
  ChallengeSummary,
} from '@kc/domain';
import { spacing, typography, Text, makeUseStyles } from '@kc/ui';
import { ChallengeProgressCard } from '../../components/challenges/ChallengeProgressCard';
import { ChallengeReportCard } from '../../components/challenges/ChallengeReportCard';
import {
  ChallengeEntriesCard,
  ChallengeLeaderboardCard,
} from '../../components/challenges/ChallengeHistoryAndLeaderboard';
import { GhostButton } from '../../components/ui/Buttons';
import { challengeErrorMessage } from '../../lib/challenges/challengeErrorMessage';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';

const useStyles = makeUseStyles(({ colors }) => ({
  actions: { marginHorizontal: spacing.base, marginTop: spacing.base, gap: spacing.md },
  error: { ...typography.bodySmall, color: colors.error, textAlign: rtlTextAlignStart },
}));

export type ChallengePostDetailPanelsProps = Readonly<{
  challenge: ChallengeSummary;
  joined: boolean;
  isCreator: boolean;
  entries: ChallengeEntry[];
  leaderboard: ChallengeLeaderboardRow[] | undefined;
  membershipError: unknown;
  membershipPending: boolean;
  reportBusy: boolean;
  reportError: unknown;
  lastResult: ChallengeProgressResult | null;
  onLeave: () => void;
  onEnd: () => void;
  onReport: (value: number, note: string | null) => void;
}>;

/** Challenge-specific actions and cards below the post-style hero (join, report, progress). */
export function ChallengePostDetailPanels(props: ChallengePostDetailPanelsProps) {
  const { t } = useTranslation();
  const styles = useStyles();
  const { challenge, joined, isCreator } = props;
  const active = challenge.status === 'active';

  return (
    <View style={styles.actions}>
      {props.membershipError ? (
        <Text style={styles.error}>{challengeErrorMessage(t, props.membershipError)}</Text>
      ) : null}
      {joined ? <ChallengeProgressCard challenge={challenge} /> : null}
      {joined && active ? (
        <ChallengeReportCard
          challenge={challenge}
          busy={props.reportBusy}
          lastResult={props.lastResult}
          errorMessage={props.reportError ? challengeErrorMessage(t, props.reportError) : null}
          onReport={props.onReport}
        />
      ) : null}
      {joined ? <ChallengeEntriesCard entries={props.entries} /> : null}
      {props.leaderboard && props.leaderboard.length > 0 ? (
        <ChallengeLeaderboardCard rows={props.leaderboard} />
      ) : null}

      {joined && !isCreator ? (
        <GhostButton label={t('challenges.detail.leave')} fullWidth onPress={props.onLeave} />
      ) : null}
      {isCreator && active ? (
        <GhostButton label={t('challenges.detail.end')} fullWidth onPress={props.onEnd} />
      ) : null}
    </View>
  );
}
