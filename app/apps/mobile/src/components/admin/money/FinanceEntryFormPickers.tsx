// FR-FIN-003 / FR-FIN-004 — chip pickers used by the ledger entry form: financial account and
// default category keys (with a free-text escape hatch handled by the form).
import { ScrollView, View } from 'react-native';
import type { FinanceAccount, FinanceDirection } from '@kc/domain';
import { categoriesForDirection } from '@kc/domain';
import { makeUseStyles, spacing } from '@kc/ui';
import { AdminFilterChip } from '../AdminFilterChip';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';

/** Active accounts as single-select chips; `null` = no account (legacy / unknown). */
export function AccountPicker({ accounts, value, onChange }: {
  readonly accounts: readonly FinanceAccount[];
  readonly value: string | null;
  readonly onChange: (id: string | null) => void;
}) {
  const styles = useStyles();
  const t = useLocaleBundle().admin.money.form;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      <AdminFilterChip label={t.noAccount} active={value === null} onPress={() => onChange(null)} />
      {accounts.filter((a) => a.isActive || a.accountId === value).map((a) => (
        <AdminFilterChip key={a.accountId} label={a.name} active={value === a.accountId} onPress={() => onChange(a.accountId)} />
      ))}
    </ScrollView>
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
  const styles = useStyles();
  const L = useLocaleBundle();
  return (
    <View style={styles.wrap}>
      {categoriesForDirection(direction).map((key) => (
        <AdminFilterChip
          key={key}
          label={L.transparency.category[key]}
          active={!customMode && value === key}
          onPress={() => onPick(key)}
        />
      ))}
      <AdminFilterChip label={L.admin.money.form.categoryCustom} active={customMode} onPress={onCustom} />
    </View>
  );
}

const useStyles = makeUseStyles(() => ({
  row: { gap: spacing.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
}));
