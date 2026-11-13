// #939 — the outbound queue of the last seven days: a status filter sheet, keyset paging and
// Resend on a failed or capacity-skipped message.
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { isWhatsAppOutboundResendable } from '@kc/domain';
import { Text } from '@kc/ui';
import { AdminFilterTopBarButton } from '../AdminSearchFilterToolbar';
import { FilterSection } from '../../filterKit/FilterSection';
import { AdminListEmpty } from '../AdminListEmpty';
import { container } from '../../../lib/container';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';
import { useInvalidateWhatsAppAdmin, useWhatsAppOutboundList } from '../../../hooks/useWhatsAppAdmin';
import { WhatsAppLoadMore } from './WhatsAppLoadMore';
import { useWhatsAppAdminStyles, whatsappAdminErrorText } from './whatsappAdminStyles';

type OutFilter = 'all' | 'queued' | 'sent' | 'failed';
const FILTERS: readonly OutFilter[] = ['all', 'queued', 'sent', 'failed'];

export function WhatsAppOutboundPanel() {
  const styles = useWhatsAppAdminStyles();
  const t = useLocaleBundle().admin.whatsapp;
  const invalidate = useInvalidateWhatsAppAdmin();
  const [filter, setFilter] = useState<OutFilter>('all');
  const [sheetOpen, setSheetOpen] = useState(false);
  const list = useWhatsAppOutboundList(filter === 'all' ? undefined : filter, true);
  const resend = useMutation({
    mutationFn: (id: string) => container.resendWhatsAppOutbound.execute(id),
    onSuccess: invalidate,
  });
  const error = whatsappAdminErrorText(t, resend.error);

  return (
    <>
      <Text style={styles.section}>{t.sections.outbound}</Text>
      <AdminFilterTopBarButton
        portalTitle={t.title}
        activeFilterCount={filter === 'all' ? 0 : 1}
        filterVisible={sheetOpen}
        onOpenFilters={() => setSheetOpen(true)}
        onCloseFilters={() => setSheetOpen(false)}
        onClearFilters={() => setFilter('all')}
        sheetTitle={t.sections.outbound}
        filterButtonTestID="admin-whatsapp-filter-button"
        filterSheetContent={(
          <FilterSection<OutFilter>
            options={FILTERS.map((f) => ({ value: f, label: t.filters[f] }))}
            value={filter}
            onChange={(f) => setFilter(f ?? 'all')}
          />
        )}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {list.rows.length === 0 ? <AdminListEmpty title={t.empty} hint="" /> : list.rows.map((row) => (
        <View key={row.outboundId} style={styles.row}>
          <Text style={styles.rowTitle}>{row.templateName ?? row.kind} · {row.status}</Text>
          <Text style={styles.muted}>{t.row.phone}: {row.waIdMasked ?? '—'} · {t.row.attempts(row.attempts)}</Text>
          {row.lastError ? <Text style={styles.error}>{row.lastError}</Text> : null}
          {isWhatsAppOutboundResendable(row.status) ? (
            <Pressable
              testID={`whatsapp-resend-${row.outboundId}`}
              accessibilityRole="button"
              style={styles.linkBtn}
              disabled={resend.isPending}
              onPress={() => resend.mutate(row.outboundId)}
            >
              <Text style={styles.link}>{t.row.resend}</Text>
            </Pressable>
          ) : null}
        </View>
      ))}
      <WhatsAppLoadMore testID="whatsapp-outbound-more" hasMore={list.hasMore} onPress={list.fetchMore} />
    </>
  );
}
