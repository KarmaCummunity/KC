// Shared top bar for the in-tabs surface — chat (left), logo (center), settings (right).
// Mirrors the pattern that lived inline in (tabs)/index.tsx; extracted so Profile,
// Donations, and Search can reuse it. The native Tabs header is hidden globally
// (see (tabs)/_layout.tsx) so each tab renders this once inside its own SafeAreaView.
//
// `extraIcon` slot: the feed renders the filter/sort icon there so it's visible
// only on the feed and disappears when navigating to another tab (FR-FEED-004).
import React from 'react';
import { Image, Platform, TouchableOpacity, View, type ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, radius, spacing, typography, useTheme, Text, iconSize } from '@kc/ui';
import { useChatStore } from '../store/chatStore';
import { useAuthStore } from '../store/authStore';
import { useNotificationInboxBadge } from '../hooks/useNotificationInboxBadge';
import { isLayoutRtl } from '../lib/rtlLayout';

/**
 * Pin the notification badge to the icon's reading-end corner.
 * Native auto-mirrors `end`; RN-Web ignores `start`/`end` for absolute
 * positioning, so on web we resolve RTL live and emit a physical key.
 */
function badgeCornerEnd(): Pick<ViewStyle, 'left' | 'right' | 'end'> {
  if (Platform.OS !== 'web') return { end: 0 };
  return isLayoutRtl() ? { left: 0 } : { right: 0 };
}

interface TopBarProps {
  /** Optional icon rendered between the logo and the settings icon. */
  extraIcon?: React.ReactNode;
}

export function TopBar({ extraIcon }: TopBarProps = {}) {
  const router = useRouter();
  const { t } = useTranslation();
  const styles = useTopBarStyles();
  const { colors } = useTheme();
  const userId = useAuthStore((s) => s.session?.userId);
  const chatUnread = useChatStore((s) => s.unreadTotal);
  const notifUnread = useNotificationInboxBadge(userId);
  const chatDisplay = chatUnread > 9 ? '9+' : String(chatUnread);
  const notifDisplay = notifUnread > 9 ? '9+' : String(notifUnread);

  return (
    <View style={styles.topBar}>
      <TouchableOpacity
        testID="topbar-chat"
        style={styles.iconBtn}
        onPress={() => router.push('/chat/')}
        accessibilityLabel={t('chat.title')}
      >
        <Ionicons name="chatbubbles-outline" size={iconSize['2xl']} color={colors.textPrimary} />
        {chatUnread > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{chatDisplay}</Text>
          </View>
        )}
      </TouchableOpacity>
      <Image source={require('../../assets/logo.png')} style={styles.logo} resizeMode="contain" />
      <View style={styles.rightGroup}>
        {extraIcon}
        <TouchableOpacity
          testID="topbar-notifications"
          style={styles.iconBtn}
          onPress={() => router.push('/notifications/inbox')}
          accessibilityLabel={t('notifications.inboxTitle')}
        >
          <Ionicons name="notifications-outline" size={iconSize['2xl']} color={colors.textPrimary} />
          {notifUnread > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{notifDisplay}</Text>
            </View>
          ) : null}
        </TouchableOpacity>
        <TouchableOpacity
          testID="topbar-settings"
          style={styles.iconBtn}
          onPress={() => router.push('/settings')}
          accessibilityLabel={t('settings.title')}
        >
          <Ionicons name="settings-outline" size={iconSize['2xl']} color={colors.textPrimary} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const useTopBarStyles = makeUseStyles(({ colors }) => ({
  topBar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    // Cream backdrop + no bottom border so the header floats over the screen,
    // mirroring the welcome screen where the content sits directly on the cream.
    backgroundColor: colors.surfaceCream,
  },
  iconBtn: { padding: spacing.xs, position: 'relative' as const },
  rightGroup: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.xs },
  logo: { height: 32, width: 80 },
  badge: {
    position: 'absolute' as const,
    top: 0,
    ...badgeCornerEnd(),
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    minWidth: 18,
    height: 18,
    paddingHorizontal: spacing.xs,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  badgeText: { ...typography.caption, ...typography.bold, color: colors.textInverse },
}));
