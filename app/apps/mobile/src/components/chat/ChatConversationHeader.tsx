// In-screen header for chat conversation — native stack header is hidden on this
// screen (see app/chat/[id].tsx) so iOS never wraps controls in UIBarButtonItem glass.
// FR-CHAT-002 / FR-CHAT-016.
import React from 'react';
import { View, Pressable, TouchableOpacity, I18nManager } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import { iconSize, useTheme, Text } from '@kc/ui';
import { MirroredIcon, useDirectionalBackIcon } from '../ui/MirroredIcon';
import { useChatConversationHeaderStyles } from './chatConversationHeader.styles';
import type { VerificationLevel } from '@kc/domain';
import { OnlineDot } from './OnlineDot';
import { VerificationBadge } from '../VerificationBadge';

interface Props {
  readonly title: string;
  readonly canOpenProfile: boolean;
  readonly shareHandle: string | null | undefined;
  readonly onOpenMenu: () => void;
  /** Counterpart user id — drives the online dot (null hides it). */
  readonly peerUserId?: string | null;
  readonly peerVerificationLevel?: VerificationLevel;
}

export function ChatConversationHeader({
  title, canOpenProfile, shareHandle, onOpenMenu, peerUserId, peerVerificationLevel,
}: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const styles = useChatConversationHeaderStyles();
  const { colors } = useTheme();
  const backIcon = useDirectionalBackIcon();
  const rtl = I18nManager.isRTL;
  // Symmetric hitSlop steals touches from the centered title on native (esp. RTL); extend only toward screen edges.
  const backHitSlop = rtl
    ? { top: 10, bottom: 10, left: 0, right: 14 }
    : { top: 10, bottom: 10, left: 14, right: 0 };
  const menuHitSlop = rtl
    ? { top: 10, bottom: 10, left: 14, right: 0 }
    : { top: 10, bottom: 10, left: 0, right: 14 };

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };

  const openProfile = () => {
    if (!shareHandle) return;
    router.push({ pathname: '/user/[handle]', params: { handle: shareHandle } });
  };

  return (
    <View style={[styles.wrap, { paddingTop: insets.top }]}>
      <View style={styles.row}>
        <Pressable
          onPress={goBack}
          hitSlop={backHitSlop}
          accessibilityRole="button"
          accessibilityLabel={t('general.back')}
          style={styles.side}
        >
          <MirroredIcon name={backIcon} size={iconSize['2xl']} color={colors.primary} />
        </Pressable>
        <TouchableOpacity
          style={styles.titleWrap}
          activeOpacity={canOpenProfile ? 0.65 : 1}
          disabled={!canOpenProfile}
          onPress={openProfile}
          accessibilityRole={canOpenProfile ? 'button' : undefined}
          accessibilityState={{ disabled: !canOpenProfile }}
        >
          <View style={styles.titleRow}>
            <OnlineDot userId={peerUserId} size={10} overlay={false} />
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            <VerificationBadge level={peerVerificationLevel} />
          </View>
        </TouchableOpacity>
        <Pressable
          onPress={onOpenMenu}
          hitSlop={menuHitSlop}
          accessibilityRole="button"
          accessibilityLabel={t('chat.headerActionsA11y')}
          style={styles.side}
        >
          <Ionicons name="ellipsis-vertical" size={iconSize.xl} color={colors.textPrimary} />
        </Pressable>
      </View>
    </View>
  );
}
