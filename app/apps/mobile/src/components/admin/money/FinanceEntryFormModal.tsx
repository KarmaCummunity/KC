// V2-ADMIN-MONEY-9 — bottom-sheet modal for create/edit a ledger entry.
import { useState } from 'react';
import { ScrollView, Switch, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import {
  FINANCE_ENTRY_KINDS, FINANCE_ENTRY_STATUSES, categoriesForDirection, directionOfKind,
  isFinanceCategoryKey, isFinanceLedgerError,
  type FinanceAccount, type FinanceEntry, type FinanceEntryKind, type FinanceEntryStatus,
} from '@kc/domain';
import { makeUseStyles, radius, spacing, Text, typography } from '@kc/ui';
import { Chip } from '../../ui/Chip';
import { container } from '../../../lib/container';
import { AdminFormField } from '../AdminFormField';
import { AdminFormActions } from '../AdminFormActions';
import { AccountPicker, CategoryPicker } from './FinanceEntryFormPickers';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';
import { parseIsoDate, toIsoDate } from '../../../lib/isoDate';

export interface FinanceEntryFormModalProps {
  readonly initial: FinanceEntry | null;
  readonly accounts: readonly FinanceAccount[];
  /** Pre-selected account for a new entry (the most recently used one). */
  readonly defaultAccountId: string | null;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}

export function FinanceEntryFormModal({
  initial, accounts, defaultAccountId, onClose, onSaved,
}: FinanceEntryFormModalProps) {
  const styles = useStyles();
  const L = useLocaleBundle();
  const t = L.admin.money;
  const isEdit = initial !== null;
  const [kind, setKind]           = useState<FinanceEntryKind>(initial?.kind ?? 'donation_in');
  const [amountText, setAmount]   = useState(initial ? (initial.amountCents / 100).toString() : '');
  const [occurredText, setOccurred] = useState(initial ? toIsoDate(initial.occurredAt) : toIsoDate(new Date()));
  const [counterparty, setCounter] = useState(initial?.counterparty ?? '');
  const [category, setCategory]   = useState(initial?.category ?? '');
  // Free-text category: an existing non-key value, or the user picked "other".
  const [customCategory, setCustomCategory] = useState(
    Boolean(initial?.category) && !isFinanceCategoryKey(initial?.category),
  );
  const [accountId, setAccountId] = useState<string | null>(initial?.accountId ?? defaultAccountId);
  const [isPublic, setIsPublic]   = useState(initial?.isPublic ?? true);
  const [description, setDesc]    = useState(initial?.description ?? '');
  const [status, setStatus]       = useState<FinanceEntryStatus>(initial?.status ?? 'cleared');
  const [errorMsg, setErrorMsg]   = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const cents = Math.round(Number.parseFloat(amountText) * 100);
      if (!Number.isFinite(cents) || cents < 0) {
        throw new Error('invalid_amount');
      }
      const occurredAt = parseIsoDate(occurredText);
      return container.upsertFinanceEntry.execute({
        entryId:      initial?.entryId ?? null,
        kind,
        amountCents:  cents,
        occurredAt,
        counterparty: counterparty.trim() || null,
        category:     category.trim()     || null,
        accountId:    accountId ?? undefined,
        isPublic,
        description:  description.trim()  || null,
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
              onPress={() => {
                setKind(k);
                // A default category belongs to one direction; drop it if the new kind flips it.
                if (isFinanceCategoryKey(category) && !categoriesForDirection(directionOfKind(k) ?? 'out').includes(category)) {
                  setCategory('');
                }
              }}
              size="sm"
            />
          ))}
        </View>

        <AdminFormField label={t.form.amountLabel}        value={amountText}  onChange={setAmount}     keyboardNumeric />
        <AdminFormField label={t.form.occurredAtLabel}    value={occurredText} onChange={setOccurred} />
        <AdminFormField label={t.form.counterpartyLabel}  value={counterparty} onChange={setCounter} />
        <Text style={styles.label}>{t.form.accountLabel}</Text>
        <AccountPicker accounts={accounts} value={accountId} onChange={setAccountId} />

        <Text style={styles.label}>{t.form.categoryLabel}</Text>
        <CategoryPicker
          direction={directionOfKind(kind) ?? 'out'}
          value={category}
          customMode={customCategory}
          onPick={(key) => { setCustomCategory(false); setCategory(key); }}
          onCustom={() => { setCustomCategory(true); if (isFinanceCategoryKey(category)) setCategory(''); }}
        />
        {customCategory && <AdminFormField label={t.form.categoryCustom} value={category} onChange={setCategory} />}
        <AdminFormField label={t.form.descriptionLabel}   value={description}  onChange={setDesc} multiline />

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

        <View style={styles.switchRow}>
          <View style={styles.switchText}>
            <Text style={styles.switchLabel}>{t.form.publicLabel}</Text>
            <Text style={styles.label}>{t.form.publicHint}</Text>
          </View>
          <Switch value={isPublic} onValueChange={setIsPublic} accessibilityLabel={t.form.publicLabel} />
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
  switchRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  switchText: { flex: 1, gap: spacing.xs },
  switchLabel: { ...typography.body, ...typography.semiBold, color: colors.textPrimary },
}));
