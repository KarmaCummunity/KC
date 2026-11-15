// #939 — the read-only activity of the last seven days: match alerts sent, live rate-limit
// counters and bot conversations.
import { View } from 'react-native';
import { Text } from '@kc/ui';
import { AdminListEmpty } from '../AdminListEmpty';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';
import { useWhatsAppActivity } from '../../../hooks/useWhatsAppAdmin';
import { useWhatsAppAdminStyles } from './whatsappAdminStyles';

export function WhatsAppActivityPanels() {
  const styles = useWhatsAppAdminStyles();
  const t = useLocaleBundle().admin.whatsapp;
  const { matches, rateHits, conversations } = useWhatsAppActivity(true);
  const empty = <AdminListEmpty title={t.empty} hint="" />;

  return (
    <>
      <Text style={styles.section}>{t.sections.matches}</Text>
      {(matches.data?.length ?? 0) === 0 ? empty : matches.data!.map((row) => (
        <View key={row.outboundId} style={styles.row}>
          <Text style={styles.rowTitle}>{row.waIdMasked ?? '—'} · {row.templateName ?? ''} · {row.status}</Text>
          <Text style={styles.muted}>{row.createdAt.toISOString()}</Text>
        </View>
      ))}

      <Text style={styles.section}>{t.sections.rateHits}</Text>
      {(rateHits.data?.length ?? 0) === 0 ? empty : rateHits.data!.map((row) => (
        <View key={`${row.bucket}-${row.windowStart.toISOString()}`} style={styles.row}>
          <Text style={styles.rowTitle}>{row.bucket}</Text>
          <Text style={styles.muted}>{t.row.hits(row.hits)} · {row.windowStart.toISOString()}</Text>
        </View>
      ))}

      <Text style={styles.section}>{t.sections.conversations}</Text>
      {(conversations.data?.length ?? 0) === 0 ? empty : conversations.data!.map((row) => (
        <View key={row.sessionId} style={styles.row}>
          <Text style={styles.rowTitle}>{row.waIdMasked ?? '—'} · {t.row.state}: {row.state}</Text>
          <Text style={styles.muted}>{row.updatedAt.toISOString()}</Text>
        </View>
      ))}
    </>
  );
}
