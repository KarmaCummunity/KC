// Legacy FR-DONATE-004 composer — support thread for direct KC volunteering interest.
import React, { useState } from 'react';
import { ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { useAuthStore } from '../../../../src/store/authStore';
import { container } from '../../../../src/lib/container';
import { Screen } from '../../../../src/components/ui/Screen';
import { Card } from '../../../../src/components/ui/Card';
import { TextField } from '../../../../src/components/ui/TextField';
import { PrimaryButton } from '../../../../src/components/ui/Buttons';
import { rtlTextAlignStart } from '../../../../src/lib/rtlTextAlignStart';

const COMPOSER_MAX_CHARS = 2000;

const useStyles = makeUseStyles(({ colors }) => ({
  scroll: { padding: spacing.lg, gap: spacing.md },
  body: {
    ...typography.body,
    color: colors.textPrimary,
    textAlign: rtlTextAlignStart,
    lineHeight: 22,
  },
  composer: { gap: spacing.md },
  errorText: { ...typography.bodySmall, color: colors.error },
}));

export default function TimeSupportComposerScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const styles = useStyles();
  const userId = useAuthStore((s) => s.session?.userId ?? null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState(false);

  const onSend = async () => {
    const body = text.trim();
    if (!body || !userId || busy) return;
    setBusy(true);
    setSendError(false);
    try {
      const chat = await container.getSupportThread.execute({ userId });
      await container.sendMessage.execute({
        chatId: chat.chatId,
        senderId: userId,
        body: `${t('donations.timeScreen.volunteerPrefix')}${body}`,
      });
      router.push({ pathname: '/chat/[id]', params: { id: chat.chatId } });
    } catch {
      setSendError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen blobs="content">
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.body}>{t('donations.timeScreen.body')}</Text>
        <Card padding="base" style={styles.composer}>
          <TextField
            label={t('donations.timeScreen.composerHeading')}
            value={text}
            onChangeText={setText}
            placeholder={t('donations.timeScreen.composerPlaceholder')}
            multiline
            maxLength={COMPOSER_MAX_CHARS}
          />
          <PrimaryButton
            label={t('donations.timeScreen.sendButton')}
            size="md"
            loading={busy}
            disabled={text.trim().length === 0}
            onPress={() => void onSend()}
          />
          {sendError ? <Text style={styles.errorText}>{t('donations.timeScreen.sendError')}</Text> : null}
        </Card>
      </ScrollView>
    </Screen>
  );
}
