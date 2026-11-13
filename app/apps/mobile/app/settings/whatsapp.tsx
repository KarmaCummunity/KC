// Settings → WhatsApp bot link (#1090, D143: Pro only). A Pro member gets a short-lived 6-digit
// code to send to the bot, can unlink the number, and switches WhatsApp match alerts on or off
// (FR-NOTIF-017 AC4). Everything goes through the WhatsApp link use cases (useWhatsAppLink).
// Hidden while the `whatsappBot` launch surface or the WHATSAPP_BOT_AVAILABLE switch is off.
import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { canRequestWhatsAppLinkCode, canToggleWhatsAppMatchAlerts } from '@kc/domain';
import { makeUseStyles, radius, spacing, typography, useTheme, Text } from '@kc/ui';
import { useShellStackScreenOptions } from '../../src/navigation/shellStackScreenOptions';
import { LaunchSurfaceGate } from '../../src/components/LaunchSurfaceGate';
import { ParkedFeatureNotice } from '../../src/components/ParkedFeatureNotice';
import { NotificationToggleRow } from '../../src/components/NotificationToggleRow';
import { WHATSAPP_BOT_AVAILABLE } from '../../src/lib/parkedFeatures';
import { rtlTextAlignStart } from '../../src/lib/rtlTextAlignStart';
import { webTextRtl, webViewRtl } from '../../src/lib/webRtlStyle';
import { confirmAction } from '../../src/services/platformConfirm';
import { useWhatsAppLink, whatsappLinkErrorKey } from '../../src/hooks/useWhatsAppLink';

export { RouteErrorBoundary as ErrorBoundary } from '../../src/components/RouteErrorBoundary';

function WhatsAppLinkBody() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useScreenStyles();
  const link = useWhatsAppLink();
  const s = link.status.data;
  const code = link.code;
  const expires = code ? code.expiresAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

  const onUnlink = async () => {
    const ok = await confirmAction(t('settings.whatsapp.unlink'), t('settings.whatsapp.unlinkConfirm'), {
      confirmLabel: t('settings.whatsapp.unlink'), destructive: true,
    });
    if (ok) link.unlink();
  };

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      <Text style={styles.text}>{t('settings.whatsapp.intro')}</Text>
      {link.status.isLoading ? <ActivityIndicator color={colors.primary} /> : null}
      {link.status.isError ? <Text style={styles.text}>{t('settings.whatsapp.failed')}</Text> : null}
      {s && !s.isPro ? <Text style={styles.text}>{t('settings.whatsapp.notPro')}</Text> : null}
      {s && canRequestWhatsAppLinkCode(s) ? (
        <View style={styles.card}>
          <Text style={styles.text} testID="settings-whatsapp-status">
            {s.linked ? t('settings.whatsapp.linked', { number: s.waIdMasked ?? '' }) : t('settings.whatsapp.notLinked')}
          </Text>
          {code ? (
            <>
              <Text style={styles.text}>{t('settings.whatsapp.codeLabel')}</Text>
              <Text style={styles.code} selectable testID="settings-whatsapp-code">{code.code}</Text>
              <Text style={styles.note}>{t('settings.whatsapp.codeExpires', { time: expires })}</Text>
            </>
          ) : null}
          <Pressable
            testID="settings-whatsapp-get-code"
            accessibilityRole="button"
            disabled={link.busy}
            onPress={link.requestCode}
            style={styles.button}
          >
            <Text style={styles.buttonText}>{t('settings.whatsapp.getCode')}</Text>
          </Pressable>
          {s.linked ? (
            <Pressable
              testID="settings-whatsapp-unlink"
              accessibilityRole="button"
              disabled={link.busy}
              onPress={() => { void onUnlink(); }}
              style={styles.linkButton}
            >
              <Text style={styles.danger}>{t('settings.whatsapp.unlink')}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {s ? (
        <View style={styles.card}>
          <NotificationToggleRow
            label={t('settings.whatsapp.alertsLabel')}
            caption={canToggleWhatsAppMatchAlerts(s) ? t('settings.whatsapp.alertsHint') : t('settings.whatsapp.alertsNeedLink')}
            value={s.consentOptedIn}
            disabled={link.busy || !canToggleWhatsAppMatchAlerts(s)}
            onValueChange={link.setConsent}
          />
          {s.phoneOptedOut ? <Text style={styles.note}>{t('settings.whatsapp.alertsPhoneStopped')}</Text> : null}
        </View>
      ) : null}
      {link.error ? <Text style={styles.danger} testID="settings-whatsapp-error">{t(whatsappLinkErrorKey(link.error))}</Text> : null}
    </ScrollView>
  );
}

function WhatsAppLinkScreenContent() {
  const shellStackScreenOptions = useShellStackScreenOptions();
  const { t } = useTranslation();
  const { colors } = useTheme();

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
      {WHATSAPP_BOT_AVAILABLE ? <WhatsAppLinkBody /> : <ParkedFeatureNotice testID="settings-whatsapp-parked" />}
    </>
  );
}

/** Hidden while `whatsappBot` is off (first launch): sends the visitor away instead of rendering. */
export default function WhatsAppLinkScreen() {
  return (
    <LaunchSurfaceGate surface="whatsappBot" redirectTo="/settings">
      <WhatsAppLinkScreenContent />
    </LaunchSurfaceGate>
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
  danger: { ...typography.body, color: colors.error, textAlign: rtlTextAlignStart, ...webTextRtl },
}));
