// FR-KNOW-012 AC1 / 18 §18.4 — consulting hour detail: declared profession, giver
// verification level, and the D40 "not binding advice" notice.
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, Text, typography } from '@kc/ui';
import type { VerificationLevel } from '@kc/domain';
import { VerificationBadge } from '../../VerificationBadge';
import { KnowledgeAdviceNotice } from './KnowledgeAdviceNotice';
import { useEventSectionStyles } from '../events/eventSectionStyles';
import { rowDirectionStart } from '../../../lib/rtlLayout';

interface Props {
  readonly details: Readonly<Record<string, unknown>>;
  readonly verificationLevel?: VerificationLevel;
}

export function ConsultingHourDetailsCard({ details, verificationLevel }: Props) {
  const { t } = useTranslation();
  const styles = useEventSectionStyles();
  const rowStyles = useRowStyles();
  const profession = typeof details['profession'] === 'string' ? details['profession'] : null;
  const professionLabel = profession
    ? t(`marketplace.optionLabels.${profession}`, { defaultValue: profession })
    : null;

  return (
    <View style={styles.box} testID="consulting-hour-section">
      {professionLabel ? (
        <Text style={styles.line} testID="consulting-profession">
          {t('knowledgeTrust.consulting.profession', { profession: professionLabel })}
        </Text>
      ) : null}
      {verificationLevel && verificationLevel > 0 ? (
        <View style={rowStyles.row} testID="consulting-verification">
          <Text style={typography.caption}>{t('knowledgeTrust.consulting.verification')}</Text>
          <VerificationBadge level={verificationLevel} />
        </View>
      ) : null}
      <KnowledgeAdviceNotice testID="consulting-advice-notice" />
    </View>
  );
}

const useRowStyles = makeUseStyles(() => ({
  row: {
    flexDirection: rowDirectionStart,
    alignItems: 'center' as const,
    gap: spacing.xs,
  },
}));
