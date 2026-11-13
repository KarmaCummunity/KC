// Activity timeline list — FR-STATS-003 (read-only, tappable rows).

import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { formatDistanceToNow } from 'date-fns';
import { he as dateFnsHe } from 'date-fns/locale/he';
import { Ionicons } from '@expo/vector-icons';
import type { PersonalActivityItem, PersonalActivityKind } from '@kc/domain';
import { iconSize, makeUseStyles, radius, spacing, typography, useTheme, Text } from '@kc/ui';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';

const KIND_ICONS: Record<PersonalActivityKind, keyof typeof Ionicons.glyphMap> = {
  post_created: 'add-circle-outline',
  post_closed_delivered: 'gift-outline',
  post_closed_no_recipient: 'close-circle-outline',
  post_reopened: 'refresh-outline',
  marked_as_recipient: 'person-outline',
  unmarked_as_recipient: 'person-remove-outline',
  post_expired: 'hourglass-outline',
  post_removed_admin: 'shield-outline',
};

type Props = {
  readonly items: PersonalActivityItem[];
  readonly loading: boolean;
  readonly error: boolean;
  readonly emptyLabel: string;
  readonly retryLabel: string;
  readonly resolveLabel: (item: PersonalActivityItem) => string;
  readonly onPressPost: (postId: string) => void;
  readonly onRetry: () => void;
};

export function ActivityTimelineList({
  items,
  loading,
  error,
  emptyLabel,
  retryLabel,
  resolveLabel,
  onPressPost,
  onRetry,
}: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  if (error) {
    return (
      <Pressable style={styles.errorBox} onPress={onRetry}>
        <Text style={styles.errorText}>{retryLabel}</Text>
      </Pressable>
    );
  }

  if (loading && items.length === 0) {
    return <ActivityIndicator color={colors.primary} style={styles.loader} />;
  }

  if (items.length === 0) {
    return <Text style={styles.empty}>{emptyLabel}</Text>;
  }

  return (
    <View style={styles.list}>
      {items.map((item) => (
        <Pressable
          key={`${item.postId}-${item.kind}-${item.occurredAt}`}
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          onPress={() => onPressPost(item.postId)}
          accessibilityRole="button"
        >
          <View style={styles.iconCircle}>
            <Ionicons name={KIND_ICONS[item.kind]} size={iconSize.md} color={colors.primaryDark} />
          </View>
          <View style={styles.body}>
            <Text style={styles.line}>{resolveLabel(item)}</Text>
            <Text style={styles.time}>
              {formatDistanceToNow(new Date(item.occurredAt), {
                addSuffix: true,
                locale: dateFnsHe,
              })}
            </Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  list: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: spacing.base,
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowPressed: { backgroundColor: colors.primarySurface },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, minWidth: 0 },
  line: { ...typography.body, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  time: { ...typography.caption, color: colors.textDisabled, textAlign: rtlTextAlignStart, marginTop: spacing.xs },
  empty: { ...typography.body, color: colors.textSecondary, textAlign: rtlTextAlignStart, padding: spacing.base },
  loader: { paddingVertical: spacing.lg },
  errorBox: {
    padding: spacing.base,
    backgroundColor: colors.errorLight,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  errorText: { ...typography.body, color: colors.error },
}));
