// #939 — the kill switch (with confirmation) and the seven-day overview tiles.
import { useMemo } from 'react';
import { View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { Text } from '@kc/ui';
import { DangerButton, PrimaryButton } from '../../ui/Buttons';
import { confirmAction } from '../../../services/platformConfirm';
import { container } from '../../../lib/container';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';
import { useInvalidateWhatsAppAdmin, useWhatsAppChannel, useWhatsAppOverview } from '../../../hooks/useWhatsAppAdmin';
import { useWhatsAppAdminStyles, whatsappAdminErrorText } from './whatsappAdminStyles';

export function WhatsAppChannelPanel() {
  const styles = useWhatsAppAdminStyles();
  const t = useLocaleBundle().admin.whatsapp;
  const invalidate = useInvalidateWhatsAppAdmin();
  const channel = useWhatsAppChannel(true);
  const overview = useWhatsAppOverview(true);
  const setEnabled = useMutation({
    mutationFn: (on: boolean) => container.setWhatsAppChannelEnabled.execute(on),
    onSuccess: invalidate,
  });
  const channelOn = channel.data?.isEnabled ?? false;

  const kpis = useMemo(() => {
    const o = overview.data;
    if (!o) return [];
    return [
      [t.overview.queued, o.outboundQueued],
      [t.overview.sent, o.outboundSent],
      [t.overview.failed, o.outboundFailed],
      [t.overview.skipped, o.outboundSkipped],
      [t.overview.consentIn, o.consentOptedIn],
      [t.overview.consentOut, o.consentOptedOut],
      [t.overview.sessions, o.sessions7d],
      [t.overview.matches, o.matchesSent7d],
      [t.overview.rateHits, o.rateHits7d],
      [t.overview.reviewPending, o.reviewPending],
    ] as const;
  }, [overview.data, t]);

  const onToggle = async () => {
    const next = !channelOn;
    const ok = await confirmAction(
      next ? t.killSwitch.confirmOnTitle : t.killSwitch.confirmOffTitle,
      next ? t.killSwitch.confirmOnBody : t.killSwitch.confirmOffBody,
      { confirmLabel: t.killSwitch.confirmOk, cancelLabel: t.killSwitch.cancel, destructive: !next },
    );
    if (ok) setEnabled.mutate(next);
  };
  const toggle = () => { void onToggle(); };
  const error = whatsappAdminErrorText(t, setEnabled.error);

  return (
    <>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t.killSwitch.label}</Text>
        <Text style={styles.muted}>{channelOn ? t.killSwitch.on : t.killSwitch.off}</Text>
        {/* Turning the channel off is the destructive side of the switch (D94); compact admin size. */}
        <View style={styles.btn}>
          {channelOn ? (
            <DangerButton testID="whatsapp-kill-switch" label={t.killSwitch.toggleOff} size="sm" disabled={setEnabled.isPending} onPress={toggle} />
          ) : (
            <PrimaryButton testID="whatsapp-kill-switch" label={t.killSwitch.toggleOn} size="sm" disabled={setEnabled.isPending} onPress={toggle} />
          )}
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>

      <Text style={styles.section}>{t.overview.title}</Text>
      <View style={styles.kpiGrid}>
        {kpis.map(([label, value]) => (
          <View key={label} style={styles.kpi}>
            <Text style={styles.kpiValue}>{value}</Text>
            <Text style={styles.kpiLabel}>{label}</Text>
          </View>
        ))}
      </View>
    </>
  );
}
