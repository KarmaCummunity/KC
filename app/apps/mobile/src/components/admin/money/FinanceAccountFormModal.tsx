// FR-FIN-003 — bottom sheet to create / edit a financial account, on the kit sheet (its own form
// scope: keyboard Next / Previous, jump to a problem) with the shared chip row and date picker.
import { useState } from 'react';
import { View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import {
  FINANCE_ACCOUNT_KINDS, isFinanceLedgerError,
  type FinanceAccount, type FinanceAccountKind,
} from '@kc/domain';
import { makeUseStyles, spacing } from '@kc/ui';
import { BottomSheet } from '../../ui/BottomSheet';
import { FormSection } from '../../ui/FormSection';
import { FilterChipRow } from '../../filterKit/FilterChipRow';
import { AdminDateField } from '../AdminDateField';
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

  const submit = () => { setErrorMsg(null); void save.mutateAsync().catch(() => undefined); };

  return (
    <BottomSheet
      visible
      onDismiss={onClose}
      dismissible={!save.isPending}
      title={initial ? f.editTitle : f.createTitle}
      testID="finance-account-form"
      footer={
        <AdminFormActions
          cancelLabel={f.cancel}
          submitLabel={f.submit}
          submittingLabel={f.submitting}
          isPending={save.isPending}
          onCancel={onClose}
          onSubmit={submit}
          errorMsg={errorMsg}
        />
      }
    >
      <View style={styles.content}>
        <AdminFormField label={f.nameLabel} value={name} onChange={setName} required />
        <FormSection label={f.kindLabel}>
          <FilterChipRow<FinanceAccountKind>
            options={FINANCE_ACCOUNT_KINDS.map((k) => ({ value: k, label: t.accounts.kind[k] }))}
            value={kind}
            onChange={(next) => next && setKind(next)}
          />
        </FormSection>
        {kind === 'bank' && <AdminFormField label={f.last4Label} value={last4} onChange={setLast4} inputKind="integer" />}
        <AdminFormField label={f.openingBalanceLabel} value={opening} onChange={setOpening} inputKind="decimal" />
        <AdminDateField label={f.openingDateLabel} value={openingDate} onChange={setOpeningDate} />
      </View>
    </BottomSheet>
  );
}

const useStyles = makeUseStyles(() => ({
  content: { gap: spacing.md },
}));
