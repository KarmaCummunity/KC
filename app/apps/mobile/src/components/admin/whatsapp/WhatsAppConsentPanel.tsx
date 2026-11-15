// #939 — numbers and their consent, keyset-paged, with Block (confirmed) for a linked member.
import { Pressable, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { Text } from '@kc/ui';
import { AdminListEmpty } from '../AdminListEmpty';
import { confirmAction } from '../../../services/platformConfirm';
import { container } from '../../../lib/container';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';
import { useInvalidateWhatsAppAdmin, useWhatsAppConsentList } from '../../../hooks/useWhatsAppAdmin';
import { WhatsAppLoadMore } from './WhatsAppLoadMore';
import { useWhatsAppAdminStyles, whatsappAdminErrorText } from './whatsappAdminStyles';

export function WhatsAppConsentPanel() {
  const styles = useWhatsAppAdminStyles();
  const t = useLocaleBundle().admin.whatsapp;
  const invalidate = useInvalidateWhatsAppAdmin();
  const list = useWhatsAppConsentList(true);
  const block = useMutation({
    mutationFn: (userId: string) => container.blockWhatsAppUser.execute(userId),
    onSuccess: invalidate,
  });
  const onBlock = async (userId: string) => {
    const ok = await confirmAction(t.confirmBlockTitle, t.confirmBlockBody, {
      confirmLabel: t.row.block, cancelLabel: t.killSwitch.cancel, destructive: true,
    });
    if (ok) block.mutate(userId);
  };
  const error = whatsappAdminErrorText(t, block.error);

  return (
    <>
      <Text style={styles.section}>{t.sections.consent}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {list.rows.length === 0 ? <AdminListEmpty title={t.empty} hint="" /> : list.rows.map((row) => (
        <View key={row.identityId} style={styles.row}>
          <Text style={styles.rowTitle}>{row.waIdMasked ?? '—'} · {row.consentStatus}</Text>
          <Text style={styles.muted}>
            {row.optedIn ? t.overview.consentIn : t.overview.consentOut}
            {row.preferredLanguage ? ` · ${t.row.lang} ${row.preferredLanguage}` : ''}
          </Text>
          {row.userId && row.optedIn ? (
            <Pressable
              testID={`whatsapp-block-${row.identityId}`}
              accessibilityRole="button"
              style={styles.linkBtn}
              disabled={block.isPending}
              onPress={() => { void onBlock(row.userId!); }}
            >
              <Text style={styles.linkDanger}>{t.row.block}</Text>
            </Pressable>
          ) : null}
        </View>
      ))}
      <WhatsAppLoadMore testID="whatsapp-consent-more" hasMore={list.hasMore} onPress={list.fetchMore} />
    </>
  );
}
