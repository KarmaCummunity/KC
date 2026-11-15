// V2-ADMIN-CRM-8 — bottom-sheet modal for create / edit CRM contact.
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import {
  CRM_CONTACT_STATUSES, isCrmContactError,
  type CrmContact, type CrmContactStatus,
} from '@kc/domain';
import { makeUseStyles, radius, spacing, Text, typography } from '@kc/ui';
import { TextField } from '../../ui/TextField';
import { Chip } from '../../ui/Chip';
import { AdminFormActions } from '../AdminFormActions';
import { container } from '../../../lib/container';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';
import { formEmailInputProps, formPhoneInputProps } from '../../../lib/platform/formTextInputHints';

export interface ContactFormModalProps {
  readonly initial: CrmContact | null;
  /** The organization whose book the contact belongs to (FR-ADMIN-032). */
  readonly orgId: string;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}

export function ContactFormModal({ initial, orgId, onClose, onSaved }: ContactFormModalProps) {
  const styles = useStyles();
  const L = useLocaleBundle();
  const t = L.admin.crm;
  const isEdit = initial !== null;
  const [name, setName]           = useState(initial?.name ?? '');
  const [organization, setOrg]    = useState(initial?.organization ?? '');
  const [email, setEmail]         = useState(initial?.email ?? '');
  const [phone, setPhone]         = useState(initial?.phone ?? '');
  const [roleTitle, setRoleTitle] = useState(initial?.roleTitle ?? '');
  const [status, setStatus]       = useState<CrmContactStatus>(initial?.status ?? 'cold');
  const [tagsRaw, setTagsRaw]     = useState(initial ? initial.tags.join(', ') : '');
  const [notes, setNotes]         = useState(initial?.notes ?? '');
  const [errorMsg, setErrorMsg]   = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      container.upsertCrmContact.execute({
        orgId,
        contactId:    initial?.contactId ?? null,
        name:         name.trim(),
        organization: organization.trim() || null,
        email:        email.trim()        || null,
        phone:        phone.trim()        || null,
        roleTitle:    roleTitle.trim()    || null,
        notes:        notes.trim()        || null,
        tags:         tagsRaw.split(',').map((s) => s.trim()).filter((s) => s.length > 0),
        status,
      }),
    onSuccess: () => onSaved(),
    onError:   (err) => {
      const code = isCrmContactError(err) ? err.code : 'unknown';
      setErrorMsg(t.errors[code as keyof typeof t.errors] ?? t.errors.unknown);
    },
  });

  return (
    <View style={styles.backdrop} pointerEvents="box-none">
      <ScrollView style={styles.sheet} contentContainerStyle={styles.content}>
        <Text style={styles.title}>{isEdit ? t.form.editTitle : t.form.createTitle}</Text>

        <TextField label={t.form.nameLabel}         value={name}         onChangeText={setName} />
        <TextField label={t.form.organizationLabel} value={organization} onChangeText={setOrg} />
        <TextField label={t.form.emailLabel} value={email} onChangeText={setEmail} {...formEmailInputProps} />
        <TextField label={t.form.phoneLabel} value={phone} onChangeText={setPhone} {...formPhoneInputProps} />
        <TextField label={t.form.roleLabel}         value={roleTitle}    onChangeText={setRoleTitle} />

        <Text style={styles.label}>{t.form.statusLabel}</Text>
        <View style={styles.statusRow}>
          {CRM_CONTACT_STATUSES.map((s) => (
            <Chip
              key={s}
              label={t.status[s]}
              selected={status === s}
              onPress={() => setStatus(s)}
              size="sm"
            />
          ))}
        </View>

        <TextField label={t.form.tagsLabel}  value={tagsRaw} onChangeText={setTagsRaw} />
        <TextField label={t.form.notesLabel} value={notes}   onChangeText={setNotes} multiline />

        <AdminFormActions
          cancelLabel={t.form.cancel}
          submitLabel={t.form.submit}
          submittingLabel={t.form.submitting}
          isPending={save.isPending}
          onCancel={onClose}
          onSubmit={() => { void save.mutateAsync(); }}
          errorMsg={errorMsg}
        />
      </ScrollView>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  backdrop: {
    position: 'absolute', top: 0, start: 0, end: 0, bottom: 0,
    backgroundColor: colors.overlay, justifyContent: 'flex-end',
  },
  sheet:   { maxHeight: '90%', backgroundColor: colors.surface,
             borderTopStartRadius: radius.lg, borderTopEndRadius: radius.lg },
  content: { padding: spacing.base, gap: spacing.md },
  title:   { ...typography.h3, ...typography.bold, color: colors.textPrimary },
  label:   { ...typography.label, color: colors.textSecondary },
  statusRow: { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' },
}));
