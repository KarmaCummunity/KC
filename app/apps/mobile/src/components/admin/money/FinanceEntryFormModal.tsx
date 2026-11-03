// V2-ADMIN-MONEY-9 — bottom-sheet modal for create/edit a ledger entry.
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import {
  FINANCE_ENTRY_KINDS, FINANCE_ENTRY_STATUSES, isFinanceLedgerError,
  type FinanceEntry, type FinanceEntryKind, type FinanceEntryStatus,
} from '@kc/domain';
import { makeUseStyles, radius, spacing, Text, typography } from '@kc/ui';
import { Chip } from '../../ui/Chip';
import { container } from '../../../lib/container';
import { AdminFormField } from '../AdminFormField';
import { AdminFormActions } from '../AdminFormActions';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';

export interface FinanceEntryFormModalProps {
  readonly initial: FinanceEntry | null;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function parseDate(value: string): Date | undefined {
  if (!DATE_RE.test(value)) return undefined;
  const d = new Date(`${value}T12:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
function fmtIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function FinanceEntryFormModal({ initial, onClose, onSaved }: FinanceEntryFormModalProps) {
  const styles = useStyles();
  const L = useLocaleBundle();
  const t = L.admin.money;
  const isEdit = initial !== null;
  const [kind, setKind]           = useState<FinanceEntryKind>(initial?.kind ?? 'donation_in');
  const [amountText, setAmount]   = useState(initial ? (initial.amountCents / 100).toString() : '');
  const [currency, setCurrency]   = useState(initial?.currency ?? 'ILS');
  const [occurredText, setOccurred] = useState(initial ? fmtIsoDate(initial.occurredAt) : fmtIsoDate(new Date()));
  const [counterparty, setCounter] = useState(initial?.counterparty ?? '');
  const [category, setCategory]   = useState(initial?.category ?? '');
  const [description, setDesc]    = useState(initial?.description ?? '');
  const [referenceUrl, setRefUrl] = useState(initial?.referenceUrl ?? '');
  const [status, setStatus]       = useState<FinanceEntryStatus>(initial?.status ?? 'cleared');
  const [errorMsg, setErrorMsg]   = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const cents = Math.round(Number.parseFloat(amountText) * 100);
      if (!Number.isFinite(cents) || cents < 0) {
        throw new Error('invalid_amount');
      }
      const occurredAt = parseDate(occurredText);
      return container.upsertFinanceEntry.execute({
        entryId:      initial?.entryId ?? null,
        kind,
        amountCents:  cents,
        currency:     currency.trim().toUpperCase() || 'ILS',
        occurredAt,
        counterparty: counterparty.trim() || null,
        category:     category.trim()     || null,
        description:  description.trim()  || null,
        referenceUrl: referenceUrl.trim() || null,
        status,
      });
    },
    onSuccess: () => onSaved(),
    onError:   (err) => {
      const code = isFinanceLedgerError(err) ? err.code : 'unknown';
      setErrorMsg(t.errors[code as keyof typeof t.errors] ?? t.errors.unknown);
    },
  });

  return (
    <View style={styles.backdrop} pointerEvents="box-none">
      <ScrollView style={styles.sheet} contentContainerStyle={styles.content}>
        <Text style={styles.title}>{isEdit ? t.form.editTitle : t.form.createTitle}</Text>

        <Text style={styles.label}>{t.form.kindLabel}</Text>
        <View style={styles.optionsRow}>
          {FINANCE_ENTRY_KINDS.map((k) => (
            <Chip
              key={k}
              label={t.kind[k]}
              selected={kind === k}
              onPress={() => setKind(k)}
              size="sm"
            />
          ))}
        </View>

        <AdminFormField label={t.form.amountLabel}        value={amountText}  onChange={setAmount}     keyboardNumeric />
        <AdminFormField label={t.form.currencyLabel}      value={currency}    onChange={setCurrency} />
        <AdminFormField label={t.form.occurredAtLabel}    value={occurredText} onChange={setOccurred} />
        <AdminFormField label={t.form.counterpartyLabel}  value={counterparty} onChange={setCounter} />
        <AdminFormField label={t.form.categoryLabel}      value={category}     onChange={setCategory} />
        <AdminFormField label={t.form.descriptionLabel}   value={description}  onChange={setDesc} multiline />
        <AdminFormField label={t.form.referenceUrlLabel}  value={referenceUrl} onChange={setRefUrl} />

        <Text style={styles.label}>{t.form.statusLabel}</Text>
        <View style={styles.optionsRow}>
          {FINANCE_ENTRY_STATUSES.map((s) => (
            <Chip
              key={s}
              label={t.status[s]}
              selected={status === s}
              onPress={() => setStatus(s)}
              size="sm"
            />
          ))}
        </View>

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
  optionsRow: { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' },
}));
