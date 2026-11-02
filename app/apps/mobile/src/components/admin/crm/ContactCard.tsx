// V2-ADMIN-CRM-8 — single CRM contact card.
import { StyleSheet, View } from 'react-native';
import type { CrmContact } from '@kc/domain';
import { makeUseStyles, radius, spacing, Text, typography } from '@kc/ui';
import { DangerButton, PrimaryButton, SecondaryButton } from '../../ui/Buttons';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';

export interface ContactCardProps {
  readonly contact: CrmContact;
  readonly onEdit: () => void;
  readonly onMarkContacted: () => void;
  readonly onDelete: () => void;
}

function fmt(d: Date): string {
  return d.toLocaleString('he-IL', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

export function ContactCard({ contact, onEdit, onMarkContacted, onDelete }: ContactCardProps) {
  const styles = useStyles();
  const L = useLocaleBundle();
  const t = L.admin.crm;
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={styles.contactName} numberOfLines={1}>{contact.name}</Text>
        <View style={[styles.statusChip, styles[`statusChip_${contact.status}` as const]]}>
          <Text style={styles.statusChipText}>{t.status[contact.status]}</Text>
        </View>
      </View>
      {contact.organization && <Text style={styles.meta}>{t.row.orgPrefix} {contact.organization}</Text>}
      {contact.roleTitle    && <Text style={styles.meta}>{t.row.rolePrefix} {contact.roleTitle}</Text>}
      {contact.email        && <Text style={styles.meta}>{t.row.emailPrefix} {contact.email}</Text>}
      {contact.phone        && <Text style={styles.meta}>{t.row.phonePrefix} {contact.phone}</Text>}
      {contact.tags.length > 0 && (
        <Text style={styles.meta}>{t.row.tagsPrefix} {contact.tags.join(', ')}</Text>
      )}
      {contact.notes && <Text style={styles.notes} numberOfLines={3}>{contact.notes}</Text>}
      <View style={styles.metaRow}>
        <Text style={styles.metaSubtle}>
          {contact.lastContactedAt ? t.row.lastContactedAt(fmt(contact.lastContactedAt)) : t.row.neverContacted}
        </Text>
        <Text style={styles.metaSubtle}>{t.row.updatedAt(fmt(contact.updatedAt))}</Text>
      </View>
      <View style={styles.actions}>
        {/* Compact admin size (spec 17 §4.3); the delete is destructive, so a DangerButton (D94). */}
        <SecondaryButton label={t.row.markContacted} size="sm" onPress={onMarkContacted} />
        <PrimaryButton label={t.row.edit} size="sm" onPress={onEdit} />
        <DangerButton label={t.row.delete} size="sm" onPress={onDelete} />
      </View>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  card: {
    margin: spacing.md, padding: spacing.md, gap: spacing.xs,
    borderRadius: radius.sm, backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  cardHead:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  contactName:  { fontSize: typography.button.fontSize, ...typography.bold, flex: 1, paddingEnd: spacing.sm },
  statusChip:   { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.xs },
  statusChip_cold:     { backgroundColor: colors.secondaryLight },
  statusChip_warm:     { backgroundColor: colors.warningLight },
  statusChip_active:   { backgroundColor: colors.successLight },
  statusChip_inactive: { backgroundColor: colors.border },
  statusChipText:      { fontSize: typography.caption.fontSize, ...typography.bold },
  meta:        { fontSize: typography.bodySmall.fontSize, opacity: 0.7 },
  notes:       { fontSize: typography.bodySmall.fontSize, marginTop: spacing.xs, opacity: 0.85 },
  metaRow:     { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs },
  metaSubtle:  { fontSize: typography.caption.fontSize, opacity: 0.55 },
  actions:     { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm, justifyContent: 'flex-end' },
}));
