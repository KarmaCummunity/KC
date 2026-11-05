// "+" in the chat inbox header — opens the recipient picker. FR-CHAT-017 AC1.
import React from 'react';
import { Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { iconSize, useTheme } from '@kc/ui';

const HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 } as const;

export function NewChatHeaderButton() {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <Pressable
      testID="chat-inbox-new"
      onPress={() => router.push('/chat/new')}
      hitSlop={HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel={t('chat.new.openA11y')}
      android_ripple={null}
      style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
    >
      <Ionicons name="add" size={iconSize.xl} color={colors.primary} />
    </Pressable>
  );
}
