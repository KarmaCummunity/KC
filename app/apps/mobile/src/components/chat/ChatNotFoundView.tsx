// Audit §14.4 — rendered when `useChatInit` resolves with no chat row
// (deleted, unauthorized, or never existed). Replaces the prior broken-empty
// header + empty bubble list with a clear "not available" screen.
import React from 'react';
import { TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, typography, spacing, Text } from '@kc/ui';
import { EmptyState } from '../EmptyState';

interface Props {
  readonly onBack: () => void;
}

export function ChatNotFoundView({ onBack }: Props) {
  const styles = useStyles();
  const { t } = useTranslation();
  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <EmptyState
        icon="chatbubble-ellipses-outline"
        title={t('chat.notFoundTitle')}
        subtitle={t('chat.notFoundSubtitle')}
        action={
          <TouchableOpacity onPress={onBack} accessibilityRole="button">
            <Text style={styles.cta}>{t('chat.notFoundBack')}</Text>
          </TouchableOpacity>
        }
      />
    </SafeAreaView>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  container: { flex: 1, backgroundColor: colors.surface },
  cta: { ...typography.body, color: colors.primary, paddingVertical: spacing.sm },
}));
