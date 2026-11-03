import React from 'react';
import { Pressable, View } from 'react-native';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import type { MessageReactionType } from '@kc/infrastructure-supabase';

const REACTIONS: MessageReactionType[] = ['like', 'love', 'laugh', 'sad'];
const EMOJI: Record<MessageReactionType, string> = {
  like: '👍',
  love: '❤️',
  laugh: '😂',
  sad: '😢',
};

export function ChatReactionChips({
  summary,
  mine,
  onPick,
}: {
  summary: Partial<Record<MessageReactionType, number>>;
  mine: MessageReactionType | null;
  onPick: (r: MessageReactionType) => void;
}) {
  const styles = useStyles();
  const total = REACTIONS.reduce((n, k) => n + (summary[k] ?? 0), 0);
  return (
    <View style={styles.row}>
      {REACTIONS.map((r) => {
        const count = summary[r] ?? 0;
        const active = mine === r;
        if (count === 0 && !active) return null;
        return (
          <Pressable
            key={r}
            onPress={() => onPick(r)}
            style={[styles.chip, active && styles.chipActive]}
            accessibilityRole="button"
          >
            <Text style={styles.chipText}>
              {EMOJI[r]}
              {count > 0 ? ` ${count}` : ''}
            </Text>
          </Pressable>
        );
      })}
      {total === 0 ? (
        <Pressable onPress={() => onPick('like')} style={styles.chip} accessibilityRole="button">
          <Text style={styles.chipText}>👍</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  chip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  chipText: { ...typography.caption },
}));
