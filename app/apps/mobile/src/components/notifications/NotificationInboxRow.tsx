// KC#869 — one notification center row: type icon, title, body, relative time, unread dot.
import React from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { iconSize, makeUseStyles, radius, spacing, typography, useTheme, Text } from '@kc/ui';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { rowDirectionStart } from '../../lib/rtlLayout';
import { notificationIcon } from '../../lib/notificationInboxView';

interface Props {
  kind: string;
  title: string;
  body: string;
  time: string;
  groupHint?: string;
  unread: boolean;
  onPress: () => void;
}

export function NotificationInboxRow({ kind, title, body, time, groupHint, unread, onPress }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: unread }}
    >
      <View style={[styles.iconWrap, unread ? styles.iconWrapUnread : null]}>
        <Ionicons name={notificationIcon(kind)} size={iconSize.lg} color={unread ? colors.primary : colors.textSecondary} />
      </View>
      <View style={styles.textCol}>
        <View style={styles.titleLine}>
          <Text style={[styles.title, unread ? styles.titleUnread : null]} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.time}>{time}</Text>
        </View>
        <Text style={styles.body} numberOfLines={2}>
          {body}
        </Text>
        {groupHint ? <Text style={styles.groupHint}>{groupHint}</Text> : null}
      </View>
      {unread ? <View style={styles.dot} /> : <View style={styles.dotSpacer} />}
    </Pressable>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  row: {
    flexDirection: rowDirectionStart,
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  pressed: { opacity: 0.7 },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  iconWrapUnread: { backgroundColor: colors.primaryLight },
  textCol: { flex: 1 },
  titleLine: { flexDirection: rowDirectionStart, alignItems: 'center', gap: spacing.sm },
  title: { ...typography.body, flex: 1, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  titleUnread: { ...typography.bold },
  time: { ...typography.caption, color: colors.textSecondary },
  body: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs, textAlign: rtlTextAlignStart },
  groupHint: { ...typography.caption, color: colors.textDisabled, marginTop: spacing.xs, textAlign: rtlTextAlignStart },
  dot: { width: 8, height: 8, borderRadius: radius.full, backgroundColor: colors.primary },
  dotSpacer: { width: 8 },
}));
