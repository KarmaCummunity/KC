// FR-KNOW-012 / D40 / 18 §18.9 — "not binding advice" notice on consulting hours and
// rights & legal aid posts (and their booking chats).
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { rtlTextAlignStart } from '../../../lib/rtlLayout';

interface Props {
  /** Optional suffix for stable testIDs when several notices appear on one screen. */
  readonly testID?: string;
}

export function KnowledgeAdviceNotice({ testID = 'knowledge-advice-notice' }: Props) {
  const { t } = useTranslation();
  const styles = useStyles();
  return (
    <View style={styles.box} testID={testID} accessibilityRole="summary">
      <Text style={styles.title}>{t('knowledgeTrust.notice.title')}</Text>
      <Text style={styles.body}>{t('knowledgeTrust.notice.body')}</Text>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  box: {
    gap: spacing.xs,
    padding: spacing.md,
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  title: {
    ...typography.h3,
    color: colors.textPrimary,
    textAlign: rtlTextAlignStart,
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: rtlTextAlignStart,
  },
}));
