// The WhatsApp send limits (super admin, `whatsapp.configure`). The current value of each field
// is read from the server and shown next to it; only the fields filled in are changed, and a
// save refreshes the console so the new values appear.
import { useState } from 'react';
import { View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import {
  invalidWhatsAppSendLimitFields,
  WHATSAPP_SEND_LIMIT_FIELDS,
  type WhatsAppSendLimitField,
  type WhatsAppSendLimits,
  type WhatsAppSendLimitsPatch,
} from '@kc/domain';
import { Text } from '@kc/ui';
import { PrimaryButton } from '../../ui/Buttons';
import { AdminFormField } from '../AdminFormField';
import { container } from '../../../lib/container';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';
import { useInvalidateWhatsAppAdmin, useWhatsAppSendLimits } from '../../../hooks/useWhatsAppAdmin';
import { useWhatsAppAdminStyles, whatsappAdminErrorText } from './whatsappAdminStyles';

type Draft = Partial<Record<WhatsAppSendLimitField, string>>;

/** The filled-in fields as numbers; a blank field is left out. */
export function draftToPatch(draft: Draft): WhatsAppSendLimitsPatch {
  const patch: WhatsAppSendLimitsPatch = {};
  for (const field of WHATSAPP_SEND_LIMIT_FIELDS) {
    const raw = draft[field]?.trim();
    if (raw) patch[field] = Number(raw);
  }
  return patch;
}

export function WhatsAppSendLimitsPanel() {
  const styles = useWhatsAppAdminStyles();
  const t = useLocaleBundle().admin.whatsapp;
  const [draft, setDraft] = useState<Draft>({});
  const current = useWhatsAppSendLimits(true);
  const invalidate = useInvalidateWhatsAppAdmin();
  const [saved, setSaved] = useState<WhatsAppSendLimits | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (patch: WhatsAppSendLimitsPatch) => container.setWhatsAppSendLimits.execute(patch),
    onSuccess: (limits) => { setSaved(limits); setDraft({}); invalidate(); },
  });
  const onSave = () => {
    const patch = draftToPatch(draft);
    const bad = invalidWhatsAppSendLimitFields(patch);
    if (bad.length > 0 || Object.keys(patch).length === 0) {
      setInvalid(t.limits.invalid(bad.map((f) => t.limits.fields[f]).join(', ') || '—'));
      return;
    }
    setInvalid(null);
    save.mutate(patch);
  };
  const error = invalid ?? whatsappAdminErrorText(t, save.error ?? current.error);
  const shown = saved ?? current.data ?? null;

  return (
    <>
      <Text style={styles.section}>{t.sections.limits}</Text>
      <View style={styles.card}>
        <Text style={styles.muted}>{t.limits.hint}</Text>
        {WHATSAPP_SEND_LIMIT_FIELDS.map((field) => (
          <View key={field}>
            <AdminFormField
              label={t.limits.fields[field]}
              value={draft[field] ?? ''}
              onChange={(v) => setDraft((d) => ({ ...d, [field]: v }))}
              keyboardNumeric
            />
            {shown ? <Text style={styles.muted}>{t.limits.current(shown[field])}</Text> : null}
          </View>
        ))}
        <View style={styles.btn}>
          <PrimaryButton testID="whatsapp-limits-save" label={t.limits.save} size="sm" loading={save.isPending} onPress={onSave} />
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {save.isSuccess && !error ? <Text style={styles.muted}>{t.limits.saved}</Text> : null}
      </View>
    </>
  );
}
