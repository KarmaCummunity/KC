// app/apps/mobile/src/components/admin/tasks/TaskDueRangeFilter.tsx
// V2-ADMIN-TASKS-3 — due-date range filter inputs (from / to) as plain text
// fields formatted YYYY-MM-DD. The list screen owns parsing; this component
// just renders + validates the format.
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { makeUseStyles, radius, spacing, typography, Text, TextInput } from '@kc/ui';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';
import { formIsoDateInputProps } from '../../../lib/platform/formTextInputHints';
import { rtlTextAlignStart } from '../../../lib/rtlTextAlignStart';

export interface TaskDueRangeFilterProps {
  readonly fromValue: string;
  readonly toValue: string;
  readonly onChange: (next: { from: string; to: string }) => void;
  readonly onClear: () => void;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidIsoDate(value: string): boolean {
  if (value.length === 0) return true; // empty = unset
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime());
}

export function TaskDueRangeFilter({ fromValue, toValue, onChange, onClear }: TaskDueRangeFilterProps) {
  const styles = useStyles();
  const L = useLocaleBundle();
  const [from, setFrom] = useState(fromValue);
  const [to, setTo]     = useState(toValue);

  const fromOk = useMemo(() => isValidIsoDate(from), [from]);
  const toOk   = useMemo(() => isValidIsoDate(to),   [to]);
  const dirty  = from !== fromValue || to !== toValue;

  return (
    <View style={styles.row}>
      <View style={styles.fieldCol}>
        <Text style={styles.label}>{L.admin.tasks.dueRange.fromLabel}</Text>
        <TextInput // brand-guard-allow: admin date range filter input, not a form field
          style={[styles.input, !fromOk && styles.invalid]}
          value={from}
          onChangeText={setFrom}
          placeholder={L.admin.tasks.dueRange.placeholder}
          textAlign={rtlTextAlignStart}
          {...formIsoDateInputProps}
        />
      </View>
      <View style={styles.fieldCol}>
        <Text style={styles.label}>{L.admin.tasks.dueRange.toLabel}</Text>
        <TextInput // brand-guard-allow: admin date range filter input, not a form field
          style={[styles.input, !toOk && styles.invalid]}
          value={to}
          onChangeText={setTo}
          placeholder={L.admin.tasks.dueRange.placeholder}
          textAlign={rtlTextAlignStart}
          {...formIsoDateInputProps}
        />
      </View>
      <View style={styles.actionsCol}>
        <Pressable
          disabled={!dirty || !fromOk || !toOk}
          onPress={() => onChange({ from, to })}
          style={[styles.applyBtn, (!dirty || !fromOk || !toOk) && styles.disabledBtn]}
        >
          <Text style={styles.applyText}>{L.admin.tasks.dueRange.apply}</Text>
        </Pressable>
        {(fromValue.length > 0 || toValue.length > 0) && (
          <Pressable
            onPress={() => { setFrom(''); setTo(''); onClear(); }}
            style={styles.clearBtn}
          >
            <Text style={styles.clearText}>{L.admin.tasks.dueRange.clear}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  row:       { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.base, paddingBottom: spacing.sm, alignItems: 'flex-end' },
  fieldCol:  { flex: 1, gap: spacing.xs },
  actionsCol:{ gap: spacing.xs },
  label:     { ...typography.caption, opacity: 0.7 },
  input: {
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radius.md,
    padding: spacing.sm, ...typography.caption, textAlign: rtlTextAlignStart, backgroundColor: colors.surface, minWidth: 110,
  },
  invalid:   { borderColor: colors.error },
  applyBtn:  { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, backgroundColor: colors.primary },
  applyText: { color: colors.textInverse, ...typography.caption, ...typography.bold },
  disabledBtn: { opacity: 0.4 },
  clearBtn:  { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.md, backgroundColor: colors.secondaryLight },
  clearText: { color: colors.textPrimary, ...typography.caption, ...typography.semiBold },
}));
