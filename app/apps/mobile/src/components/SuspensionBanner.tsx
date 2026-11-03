// D33 / D61 — shown while the signed-in user is suspended: they can still
// browse and chat with support; posting and other actions are blocked server-side.
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, radius, spacing, Text, typography } from '@kc/ui';
import { container } from '../lib/container';
import { useAuthStore } from '../store/authStore';
import { useSuspensionStore } from '../store/suspensionStore';

export function SuspensionBanner() {
  const styles = useStyles();
  const { t } = useTranslation();
  const router = useRouter();
  const suspension = useSuspensionStore((s) => s.suspension);
  const userId = useAuthStore((s) => s.session?.userId ?? null);
  const [busy, setBusy] = useState(false);
  if (!suspension || !userId) return null;

  const openSupport = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const chat = await container.getSupportThread.execute({ userId });
      router.push({ pathname: '/chat/[id]', params: { id: chat.chatId } });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap} accessibilityRole="alert">
      <Text style={styles.text}>{t('moderation.suspendedBanner.body')}</Text>
      <Pressable onPress={() => void openSupport()} accessibilityRole="button" style={styles.cta} disabled={busy}>
        <Text style={styles.ctaText}>{t('moderation.suspendedBanner.contactSupport')}</Text>
      </Pressable>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    backgroundColor: colors.errorLight,
  },
  text: { ...typography.bodySmall, color: colors.error, flex: 1 },
  cta: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2, borderRadius: radius.md, backgroundColor: colors.error },
  ctaText: { ...typography.bodySmall, color: colors.textInverse },
}));
