// FR-FIN-003 / FR-FIN-004 — chip pickers used by the ledger entry form: financial account and
// default category keys (with a free-text escape hatch handled by the form). Both are the shared
// sideways-scrolling chip row (FR-RESP-006 AC28).
import type { FinanceAccount, FinanceDirection } from '@kc/domain';
import { categoriesForDirection } from '@kc/domain';
import { FilterChipRow } from '../../filterKit/FilterChipRow';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';

/** Option value of the "no account" chip (an account id is never empty). */
const NO_ACCOUNT = '';
/** Option value of the "custom category" chip (a category key is never empty). */
const CUSTOM = '';

/** Active accounts as single-select chips; `null` = no account (legacy / unknown). */
export function AccountPicker({ accounts, value, onChange }: {
  readonly accounts: readonly FinanceAccount[];
  readonly value: string | null;
  readonly onChange: (id: string | null) => void;
}) {
  const t = useLocaleBundle().admin.money.form;
  const options = [
    { value: NO_ACCOUNT, label: t.noAccount },
    ...accounts.filter((a) => a.isActive || a.accountId === value).map((a) => ({ value: a.accountId, label: a.name })),
  ];
  return (
    <FilterChipRow<string>
      options={options}
      value={value ?? NO_ACCOUNT}
      onChange={(next) => next !== null && onChange(next === NO_ACCOUNT ? null : next)}
    />
  );
}

/** Category keys for the entry's direction plus a "custom" chip that reveals the free-text field. */
export function CategoryPicker({ direction, value, customMode, onPick, onCustom }: {
  readonly direction: FinanceDirection;
  readonly value: string;
  readonly customMode: boolean;
  readonly onPick: (key: string) => void;
  readonly onCustom: () => void;
}) {
  const L = useLocaleBundle();
  const options = [
    ...categoriesForDirection(direction).map((key) => ({ value: key as string, label: L.transparency.category[key] })),
    { value: CUSTOM, label: L.admin.money.form.categoryCustom },
  ];
  // Nothing is selected while a free-text category not in the list is being typed.
  const selected = customMode ? CUSTOM : options.some((o) => o.value === value) ? value : null;
  return (
    <FilterChipRow<string>
      options={options}
      value={selected}
      onChange={(next) => {
        if (next === null) return;
        if (next === CUSTOM) onCustom();
        else onPick(next);
      }}
    />
  );
}
