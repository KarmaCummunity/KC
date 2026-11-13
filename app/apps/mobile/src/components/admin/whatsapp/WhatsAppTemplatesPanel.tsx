// Message templates and their Meta state. Staff see the list; only a super admin
// (`whatsapp.configure`) records a new Meta state, since `approved` makes a template sendable.
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { WHATSAPP_TEMPLATE_META_STATUSES, type WhatsAppTemplateMetaStatus, type WhatsAppTemplateRow } from '@kc/domain';
import { Text } from '@kc/ui';
import { AdminListEmpty } from '../AdminListEmpty';
import { container } from '../../../lib/container';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';
import { useInvalidateWhatsAppAdmin, useWhatsAppTemplates } from '../../../hooks/useWhatsAppAdmin';
import { useWhatsAppAdminStyles, whatsappAdminErrorText } from './whatsappAdminStyles';

const keyOf = (row: WhatsAppTemplateRow) => `${row.templateName}:${row.languageCode}`;

export function WhatsAppTemplatesPanel({ canConfigure }: { readonly canConfigure: boolean }) {
  const styles = useWhatsAppAdminStyles();
  const t = useLocaleBundle().admin.whatsapp;
  const invalidate = useInvalidateWhatsAppAdmin();
  const templates = useWhatsAppTemplates(true);
  const [editing, setEditing] = useState<string | null>(null);
  const setStatus = useMutation({
    mutationFn: (args: { row: WhatsAppTemplateRow; status: WhatsAppTemplateMetaStatus }) =>
      container.setWhatsAppTemplateStatus.execute({
        templateName: args.row.templateName, languageCode: args.row.languageCode, metaStatus: args.status,
      }),
    onSuccess: () => { setEditing(null); invalidate(); },
  });
  const statusLabel = (s: string) => t.templates.statuses[s as WhatsAppTemplateMetaStatus] ?? s;
  const error = whatsappAdminErrorText(t, setStatus.error);
  const rows = templates.data ?? [];

  return (
    <>
      <Text style={styles.section}>{t.sections.templates}</Text>
      {canConfigure ? null : <Text style={styles.muted}>{t.templates.superAdminOnly}</Text>}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {rows.length === 0 ? <AdminListEmpty title={t.empty} hint="" /> : rows.map((row) => (
        <View key={keyOf(row)} style={styles.row}>
          <Text style={styles.rowTitle}>{row.templateName} · {row.languageCode}</Text>
          <Text style={styles.muted}>{t.templates.status}: {statusLabel(row.metaStatus)}</Text>
          <Text style={styles.muted} numberOfLines={2}>{row.bodyPreview}</Text>
          {canConfigure && editing !== keyOf(row) ? (
            <Pressable
              testID={`whatsapp-template-edit-${keyOf(row)}`}
              accessibilityRole="button"
              style={styles.linkBtn}
              onPress={() => setEditing(keyOf(row))}
            >
              <Text style={styles.link}>{t.templates.setStatus}</Text>
            </Pressable>
          ) : null}
          {canConfigure && editing === keyOf(row) ? (
            <View style={styles.actions}>
              {WHATSAPP_TEMPLATE_META_STATUSES.filter((s) => s !== row.metaStatus).map((status) => (
                <Pressable
                  key={status}
                  testID={`whatsapp-template-status-${keyOf(row)}-${status}`}
                  accessibilityRole="button"
                  style={styles.linkBtn}
                  disabled={setStatus.isPending}
                  onPress={() => setStatus.mutate({ row, status })}
                >
                  <Text style={styles.link}>{statusLabel(status)}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      ))}
    </>
  );
}
