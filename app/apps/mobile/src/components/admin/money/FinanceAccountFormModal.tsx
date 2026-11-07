// FR-FIN-003 — bottom-sheet modal to create / edit a financial account.
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import {
  FINANCE_ACCOUNT_KINDS, isFinanceLedgerError,
  type FinanceAccount, type FinanceAccountKind,
} from '@kc/domain';
import { makeUseStyles, radius, spacing, Text, typography } from '@kc/ui';
import { AdminFilterChip } from '../AdminFilterChip';
import { AdminFormField } from '../AdminFormField';
import { AdminFormActions } from '../AdminFormActions';
import { container } from '../../../lib/container';
import { parseIsoDate, toIsoDate } from '../../../lib/isoDate';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';

export interface FinanceAccountFormModalProps {
  readonly initial: FinanceAccount | null;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}

/** Blank = leave to the server default; otherwise shekels with up to two decimals → agorot. */
function parseOpeningCents(text: string): number | undefined {
  if (text.trim() === '') return undefined;
  const cents = Math.round(Number.parseFloat(text) * 100);
  if (!Number.isFinite(cents)) throw new Error('invalid_amount');
  return cents;
}

export function FinanceAccountFormModal({ initial, onClose, onSaved }: FinanceAccountFormModalProps) {
  const styles = useStyles();
  const t = useLocaleBundle().admin.money;
  const f = t.accounts.form;
  const [name, setName] = useState(initial?.name ?? '');
  const [kind, setKind] = useState<FinanceAccountKind>(initial?.kind ?? 'bank');
  const [last4, setLast4] = useState(initial?.last4 ?? '');
  const [opening, setOpening] = useState(initial ? (initial.openingBalanceCents / 100).toString() : '');
  const [openingDate, setOpeningDate] = useState(initial?.openingBalanceAt ? toIsoDate(initial.openingBalanceAt) : '');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      container.upsertFinanceAccount.execute({
        accountId: initial?.accountId ?? null,
        name,
        kind,
        // Only bank accounts carry digits; an empty string clears a previously stored value.
        last4: kind === 'bank' ? last4.trim() : '',
        openingBalanceCents: parseOpeningCents(opening),
        openingBalanceAt: parseIsoDate(openingDate),
      }),
    onSuccess: () => onSaved(),
    onError: (err) => {
      const code = isFinanceLedgerError(err) ? err.code : 'unknown';
      setErrorMsg(t.errors[code as keyof typeof t.errors] ?? t.errors.unknown);
    },
  });

  return (
    <View style={styles.backdrop} pointerEvents="box-none">
      <ScrollView style={styles.sheet} contentContainerStyle={styles.content}>
        <Text style={styles.title}>{initial ? f.editTitle : f.createTitle}</Text>

        <AdminFormField label={f.nameLabel} value={name} onChange={setName} />

        <Text style={styles.label}>{f.kindLabel}</Text>
        <View style={styles.optionsRow}>
          {FINANCE_ACCOUNT_KINDS.map((k) => (
            <AdminFilterChip key={k} label={t.accounts.kind[k]} active={kind === k} onPress={() => setKind(k)} />
          ))}
        </View>

        {kind === 'bank' && <AdminFormField label={f.last4Label} value={last4} onChange={setLast4} keyboardNumeric />}
        <AdminFormField label={f.openingBalanceLabel} value={opening} onChange={setOpening} keyboardNumeric />
        <AdminFormField label={f.openingDateLabel} value={openingDate} onChange={setOpeningDate} />

        <AdminFormActions
          cancelLabel={f.cancel}
          submitLabel={f.submit}
          submittingLabel={f.submitting}
          isPending={save.isPending}
          onCancel={onClose}
          onSubmit={() => { setErrorMsg(null); void save.mutateAsync().catch(() => undefined); }}
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
  sheet: {
    maxHeight: '90%', backgroundColor: colors.surface,
    borderTopStartRadius: radius.lg, borderTopEndRadius: radius.lg,
  },
  content: { padding: spacing.base, gap: spacing.md },
  title: { ...typography.h3, ...typography.bold, color: colors.textPrimary },
  label: { ...typography.label, color: colors.textSecondary },
  optionsRow: { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' },
}));
