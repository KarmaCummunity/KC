// The WhatsApp send limits (super admin, `whatsapp.configure`). Only the fields filled in are
// changed; the saved row comes back and is shown next to each field. There is no reader RPC
// for the limits, so the current values appear after the first save.
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
  const [saved, setSaved] = useState<WhatsAppSendLimits | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (patch: WhatsAppSendLimitsPatch) => container.setWhatsAppSendLimits.execute(patch),
    onSuccess: (limits) => { setSaved(limits); setDraft({}); },
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
  const error = invalid ?? whatsappAdminErrorText(t, save.error);

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
            {saved ? <Text style={styles.muted}>{t.limits.current(saved[field])}</Text> : null}
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
