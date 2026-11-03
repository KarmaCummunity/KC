// FR-CHAT-012 — unread badge in top-bar.
import React from 'react';
import { Platform, View, TouchableOpacity, type ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '../store/chatStore';
import { iconSize, makeUseStyles, radius, spacing, typography, useTheme, Text } from '@kc/ui';
import { isLayoutRtl } from '../lib/rtlLayout';

/**
 * Pin the unread badge to the icon's reading-end corner.
 * Native auto-mirrors `end`; RN-Web ignores `start`/`end` for absolute
 * positioning, so on web we resolve RTL live and emit a physical key.
 */
function badgeCornerEnd(): Pick<ViewStyle, 'left' | 'right' | 'end'> {
  if (Platform.OS !== 'web') return { end: 0 };
  return isLayoutRtl() ? { left: 0 } : { right: 0 };
}

export function ChatBadge() {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const total = useChatStore((s) => s.unreadTotal);
  const display = total > 9 ? '9+' : String(total);
  return (
    <TouchableOpacity onPress={() => router.push('/chat')} style={styles.wrap} accessibilityLabel={t('chat.title')}>
      <Ionicons name="chatbubbles-outline" size={iconSize.xl} color={colors.textPrimary} />
      {total > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{display}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  wrap: { padding: spacing.xs, position: 'relative' },
  badge: {
    position: 'absolute', top: 0, ...badgeCornerEnd(),
    backgroundColor: colors.primary, borderRadius: radius.full,
    minWidth: 18, height: 18, paddingHorizontal: spacing.xs,
    justifyContent: 'center', alignItems: 'center',
  },
  badgeText: { ...typography.caption, color: colors.textInverse, ...typography.bold },
}));
