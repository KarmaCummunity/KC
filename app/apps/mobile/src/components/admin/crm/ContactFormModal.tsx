// V2-ADMIN-CRM-8 — bottom sheet to create / edit a CRM contact, on the kit sheet (its own form scope)
// with the shared chip row for the status.
import { useState } from 'react';
import { View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import {
  CRM_CONTACT_STATUSES, isCrmContactError,
  type CrmContact, type CrmContactStatus,
} from '@kc/domain';
import { makeUseStyles, spacing } from '@kc/ui';
import { TextField } from '../../ui/TextField';
import { AdminFormActions } from '../AdminFormActions';
import { container } from '../../../lib/container';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';
import { BottomSheet } from '../../ui/BottomSheet';
import { FormSection } from '../../ui/FormSection';
import { FilterChipRow } from '../../filterKit/FilterChipRow';

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
    <BottomSheet
      visible
      onDismiss={onClose}
      dismissible={!save.isPending}
      title={isEdit ? t.form.editTitle : t.form.createTitle}
      testID="crm-contact-form"
      footer={
        <AdminFormActions
          cancelLabel={t.form.cancel}
          submitLabel={t.form.submit}
          submittingLabel={t.form.submitting}
          isPending={save.isPending}
          onCancel={onClose}
          onSubmit={() => { void save.mutateAsync(); }}
          errorMsg={errorMsg}
        />
      }
    >
      <View style={styles.content}>
        <TextField label={t.form.nameLabel} value={name} onChangeText={setName} inputKind="name" required />
        <TextField label={t.form.organizationLabel} value={organization} onChangeText={setOrg} />
        <TextField label={t.form.emailLabel} value={email} onChangeText={setEmail} inputKind="email" />
        <TextField label={t.form.phoneLabel} value={phone} onChangeText={setPhone} inputKind="phone" />
        <TextField label={t.form.roleLabel} value={roleTitle} onChangeText={setRoleTitle} />
        <FormSection label={t.form.statusLabel}>
          <FilterChipRow<CrmContactStatus>
            options={CRM_CONTACT_STATUSES.map((s) => ({ value: s, label: t.status[s] }))}
            value={status}
            onChange={(next) => next && setStatus(next)}
          />
        </FormSection>
        <TextField label={t.form.tagsLabel} value={tagsRaw} onChangeText={setTagsRaw} />
        <TextField label={t.form.notesLabel} value={notes} onChangeText={setNotes} multiline />
      </View>
    </BottomSheet>
  );
}

const useStyles = makeUseStyles(() => ({
  content: { gap: spacing.md },
}));
