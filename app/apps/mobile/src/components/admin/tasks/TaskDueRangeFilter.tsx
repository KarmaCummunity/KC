// V2-ADMIN-TASKS-3 — due-date range filter (from / to). Each day is picked with the kit date field
// (FR-RESP-006 AC31) and kept as `YYYY-MM-DD`; the list screen owns parsing.
import { useState } from 'react';
import { View } from 'react-native';
import { makeUseStyles, spacing } from '@kc/ui';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';
import { AdminDateField } from '../AdminDateField';
import { GhostButton, PrimaryButton } from '../../ui/Buttons';

export interface TaskDueRangeFilterProps {
  readonly fromValue: string;
  readonly toValue: string;
  readonly onChange: (next: { from: string; to: string }) => void;
  readonly onClear: () => void;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True for '' (unset) or a real `YYYY-MM-DD` day; the screen reads URL / state values through it. */
export function isValidIsoDate(value: string): boolean {
  if (value.length === 0) return true;
  if (!ISO_DATE.test(value)) return false;
  return !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
}

export function TaskDueRangeFilter({ fromValue, toValue, onChange, onClear }: TaskDueRangeFilterProps) {
  const styles = useStyles();
  const t = useLocaleBundle().admin.tasks.dueRange;
  const [from, setFrom] = useState(fromValue);
  const [to, setTo] = useState(toValue);
  const dirty = from !== fromValue || to !== toValue;

  return (
    <View style={styles.root}>
      <View style={styles.fields}>
        <View style={styles.field}>
          <AdminDateField label={t.fromLabel} value={from} onChange={setFrom} />
        </View>
        <View style={styles.field}>
          <AdminDateField label={t.toLabel} value={to} onChange={setTo} />
        </View>
      </View>
      <View style={styles.actions}>
        <PrimaryButton label={t.apply} size="sm" disabled={!dirty} onPress={() => onChange({ from, to })} />
        {fromValue.length > 0 || toValue.length > 0 ? (
          <GhostButton
            label={t.clear}
            size="sm"
            onPress={() => {
              setFrom('');
              setTo('');
              onClear();
            }}
          />
        ) : null}
      </View>
    </View>
  );
}

const useStyles = makeUseStyles(() => ({
  root: { gap: spacing.sm, paddingHorizontal: spacing.base, paddingBottom: spacing.sm },
  fields: { flexDirection: 'row', gap: spacing.sm },
  field: { flex: 1, minWidth: 0 },
  actions: { flexDirection: 'row', gap: spacing.sm },
}));
