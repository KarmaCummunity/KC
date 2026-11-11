// Settings → WhatsApp bot link (#1090). Pro users get a short-lived 6-digit code to send to the bot.
import React from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { makeUseStyles, radius, spacing, typography, useTheme, Text } from '@kc/ui';
import { useShellStackScreenOptions } from '../../src/navigation/shellStackScreenOptions';
import { rtlTextAlignStart } from '../../src/lib/rtlTextAlignStart';
import { webTextRtl, webViewRtl } from '../../src/lib/webRtlStyle';
import { legacySupabase } from '../../src/lib/container';

interface LinkStatus { linked: boolean; wa_id_masked: string | null; is_pro: boolean }
interface LinkCode { code: string; expires_at: string }

const STATUS_KEY = ['whatsapp-link-status'];

async function fetchStatus(): Promise<LinkStatus> {
  const { data, error } = await legacySupabase.rpc('api_whatsapp_my_link_status');
  if (error) throw error;
  return data as unknown as LinkStatus;
}

export default function WhatsAppLinkScreen() {
  const shellStackScreenOptions = useShellStackScreenOptions();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useScreenStyles();
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: STATUS_KEY, queryFn: fetchStatus });
  const [code, setCode] = React.useState<LinkCode | null>(null);
  const [busy, setBusy] = React.useState(false);

  const fail = React.useCallback(() => Alert.alert(t('general.error'), t('settings.whatsapp.failed')), [t]);

  const onGetCode = React.useCallback(async () => {
    setBusy(true);
    try {
      const { data, error } = await legacySupabase.rpc('api_whatsapp_create_link_code');
      if (error) throw error;
      setCode(data as unknown as LinkCode);
    } catch {
      fail();
    } finally {
      setBusy(false);
    }
  }, [fail]);

  const doUnlink = React.useCallback(async () => {
    setBusy(true);
    try {
      const { error } = await legacySupabase.rpc('api_whatsapp_unlink_me');
      if (error) throw error;
      setCode(null);
      await queryClient.invalidateQueries({ queryKey: STATUS_KEY });
    } catch {
      fail();
    } finally {
      setBusy(false);
    }
  }, [fail, queryClient]);

  const onUnlink = React.useCallback(() => {
    Alert.alert(t('settings.whatsapp.unlink'), t('settings.whatsapp.unlinkConfirm'), [
      { text: t('general.cancel'), style: 'cancel' },
      { text: t('settings.whatsapp.unlink'), style: 'destructive', onPress: () => void doUnlink() },
    ]);
  }, [doUnlink, t]);

  const s = status.data;
  const expires = code ? new Date(code.expires_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <>
      <Stack.Screen
        options={{
          ...shellStackScreenOptions,
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.primary,
          headerTitle: t('settings.whatsapp.title'),
        }}
      />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.text}>{t('settings.whatsapp.intro')}</Text>
        {status.isLoading && <ActivityIndicator color={colors.primary} />}
        {status.isError && <Text style={styles.text}>{t('settings.whatsapp.failed')}</Text>}
        {s && !s.is_pro && <Text style={styles.text}>{t('settings.whatsapp.notPro')}</Text>}
        {s?.is_pro && (
          <View style={styles.card}>
            <Text style={styles.text}>
              {s.linked ? t('settings.whatsapp.linked', { number: s.wa_id_masked ?? '' }) : t('settings.whatsapp.notLinked')}
            </Text>
            {code && (
              <>
                <Text style={styles.text}>{t('settings.whatsapp.codeLabel')}</Text>
                <Text style={styles.code} selectable>{code.code}</Text>
                <Text style={styles.note}>{t('settings.whatsapp.codeExpires', { time: expires })}</Text>
              </>
            )}
            <Pressable accessibilityRole="button" disabled={busy} onPress={onGetCode} style={styles.button}>
              <Text style={styles.buttonText}>{t('settings.whatsapp.getCode')}</Text>
            </Pressable>
            {s.linked && (
              <Pressable accessibilityRole="button" disabled={busy} onPress={onUnlink} style={styles.linkButton}>
                <Text style={styles.danger}>{t('settings.whatsapp.unlink')}</Text>
              </Pressable>
            )}
          </View>
        )}
      </ScrollView>
    </>
  );
}

const useScreenStyles = makeUseStyles(({ colors }) => ({
  scroll: { flex: 1, backgroundColor: colors.background, ...webViewRtl },
  scrollContent: { padding: spacing.base, paddingBottom: spacing['3xl'], gap: spacing.md, ...webViewRtl },
  text: { ...typography.body, color: colors.textPrimary, textAlign: rtlTextAlignStart, width: '100%', ...webTextRtl },
  note: { ...typography.caption, color: colors.textSecondary, textAlign: rtlTextAlignStart, width: '100%', ...webTextRtl },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    padding: spacing.base, gap: spacing.md, ...webViewRtl,
  },
  code: { ...typography.h1, color: colors.primary, textAlign: 'center' as const, letterSpacing: 6 },
  button: { backgroundColor: colors.primary, borderRadius: radius.sm, paddingVertical: spacing.md, alignItems: 'center' as const },
  buttonText: { ...typography.button, color: colors.textInverse },
  linkButton: { paddingVertical: spacing.sm, alignItems: 'center' as const },
  danger: { ...typography.body, color: colors.error },
}));
