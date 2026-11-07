import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ChallengeSummary } from '@kc/domain';
import { spacing } from '@kc/ui';
import { KcRowCard } from '../cards/KcRowCard';
import { challengeGoalLabel } from '../../lib/challenges/challengeLabels';

const ROW_STYLE = { marginHorizontal: spacing.lg };

interface ChallengeRowProps {
  readonly challenge: ChallengeSummary;
  readonly onPress: (challengeId: string) => void;
}

/** One challenge in a list: scope badge, cadence + measurement, goal, participants, my status. */
export function ChallengeRow({ challenge, onPress }: ChallengeRowProps) {
  const { t } = useTranslation();
  const goal = challengeGoalLabel(t, challenge);
  const statusLabel =
    challenge.status === 'ended'
      ? t('challenges.endedTag')
      : challenge.joined
        ? t('challenges.joinedTag')
        : null;
  return (
    <KcRowCard
      testID={`challenge-row-${challenge.challengeId}`}
      containerStyle={ROW_STYLE}
      tone="give"
      badgeLabel={t(`challenges.scope.${challenge.scope}`)}
      placeholderIcon="trophy-outline"
      title={challenge.title}
      meta={[
        `${t(`challenges.cadence.${challenge.cadence}`)} · ${t(`challenges.measurement.${challenge.measurement}`)}`,
        goal,
        t('challenges.participants', { n: challenge.participantsCount }),
      ]}
      statusLabel={statusLabel}
      onPress={() => onPress(challenge.challengeId)}
    />
  );
}
