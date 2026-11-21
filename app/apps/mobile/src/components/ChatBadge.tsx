// FR-CHAT-012 — unread badge in top-bar.
import React from 'react';
import { View, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '../store/chatStore';
import { iconSize, makeUseStyles, radius, spacing, typography, useTheme, Text } from '@kc/ui';
import { absoluteCornerEnd } from '../lib/rtlLayout';

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
    position: 'absolute', top: 0, ...absoluteCornerEnd(0),
    backgroundColor: colors.primary, borderRadius: radius.full,
    minWidth: 18, height: 18, paddingHorizontal: spacing.xs,
    justifyContent: 'center', alignItems: 'center',
  },
  badgeText: { ...typography.caption, color: colors.textInverse, ...typography.bold },
}));
