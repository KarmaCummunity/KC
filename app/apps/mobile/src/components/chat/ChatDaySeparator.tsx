// Centered day label between message groups — FR-CHAT-002.
import React, { useMemo } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, typography, spacing, radius, Text } from '@kc/ui';

function startOfLocalDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function labelForDay(anchorIso: string, t: (key: string) => string): string {
  const d = new Date(anchorIso);
  const today = new Date();
  const diffDays = Math.round((startOfLocalDay(today) - startOfLocalDay(d)) / 86400000);
  if (diffDays === 0) return t('general.today');
  if (diffDays === 1) return t('general.yesterday');
  const sameYear = d.getFullYear() === today.getFullYear();
  return d.toLocaleDateString('he-IL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' as const }),
  });
}

function ChatDaySeparatorInner({ anchorIso }: { readonly anchorIso: string }) {
  const { t } = useTranslation();
  const styles = useChatDaySeparatorStyles();
  const label = useMemo(() => labelForDay(anchorIso, t), [anchorIso, t]);
  return (
    <View style={styles.wrap} accessibilityRole="text" accessibilityLabel={label}>
      <View style={styles.pill}>
        <Text style={styles.text}>{label}</Text>
      </View>
    </View>
  );
}

export const ChatDaySeparator = React.memo(ChatDaySeparatorInner);

const useChatDaySeparatorStyles = makeUseStyles(({ colors }) => ({
  wrap: { alignItems: 'center', paddingVertical: spacing.xs },
  pill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  text: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' },
}));
