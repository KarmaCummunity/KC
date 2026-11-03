// app/apps/mobile/src/components/admin/admins/ChoiceChips.tsx
// FR-ADMIN-030 — single-choice chip group used by the grant and change-role
// modals (the grant scope and the role), one kit filter `Chip` per option (spec 17 §4.1).
import { View } from 'react-native';
import { makeUseStyles, spacing } from '@kc/ui';
import { rowDirectionStart } from '../../../lib/rtlLayout';
import { Chip } from '../../ui/Chip';

export interface ChoiceOption<K> {
  readonly key: K;
  readonly label: string;
}

export interface ChoiceChipsProps<K> {
  readonly options: readonly ChoiceOption<K>[];
  readonly selected: K | undefined;
  readonly onSelect: (key: K) => void;
}

/** Keys may be `null` (the platform scope), so React keys are derived. */
function keyOf<K>(key: K): string {
  return key === null ? '__null__' : String(key);
}

export function ChoiceChips<K>({ options, selected, onSelect }: ChoiceChipsProps<K>) {
  const styles = useStyles();
  return (
    <View style={styles.row}>
      {options.map((o) => (
        <Chip
          key={keyOf(o.key)}
          label={o.label}
          selected={selected !== undefined && keyOf(selected) === keyOf(o.key)}
          onPress={() => onSelect(o.key)}
        />
      ))}
    </View>
  );
}

const useStyles = makeUseStyles(() => ({
  row: { flexDirection: rowDirectionStart, flexWrap: 'wrap', gap: spacing.sm },
}));
