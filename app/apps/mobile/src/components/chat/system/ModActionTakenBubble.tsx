// FR-ADMIN-002..005 — neutral "handled" bubble. Renders the body provided by
// the trigger (server already substitutes action/time); falls back to the
// template-with-blanks if the body is empty.
import React from 'react';
import { View } from 'react-native';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { useTranslation } from 'react-i18next';
import type { SystemMessageBubbleProps } from './SystemMessageBubble';

const useStyles = makeUseStyles(({ colors }) => ({
  bubble: { padding: spacing.xs, alignSelf: 'center', opacity: 0.6 },
  body: { ...typography.caption, color: colors.textSecondary },
}));

export function ModActionTakenBubble({ body, createdAt }: SystemMessageBubbleProps) {
  const styles = useStyles();
  const { t } = useTranslation();
  const time = new Date(createdAt).toLocaleTimeString('he-IL', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const fallback = t('moderation.bubble.modActionTaken.body')
    .replace('{time}', time)
    .replace('{action}', '');
  const text = body.length > 0 ? body : fallback;
  return (
    <View style={styles.bubble}>
      <Text style={styles.body}>{text}</Text>
    </View>
  );
}
