import React from 'react';
import { View } from 'react-native';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { FilterChipRow } from '../filterKit/FilterChipRow';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';

export interface ChipOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

interface OptionChipsProps<T extends string> {
  readonly label: string;
  readonly options: ReadonlyArray<ChipOption<T>>;
  readonly selected: T | null;
  readonly onSelect: (value: T) => void;
  /** Explains the selected option (shown under the chips). */
  readonly hint?: string;
  readonly testID?: string;
}

const useStyles = makeUseStyles(({ colors }) => ({
  group: { gap: spacing.xs },
  label: { ...typography.bodySmall, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  hint: { ...typography.caption, color: colors.textSecondary, textAlign: rtlTextAlignStart },
}));

/** A labelled single-choice row of filter chips, used by the "open a challenge" form. */
export function OptionChips<T extends string>({
  label,
  options,
  selected,
  onSelect,
  hint,
  testID,
}: OptionChipsProps<T>) {
  const styles = useStyles();
  return (
    <View style={styles.group} testID={testID}>
      <Text style={styles.label}>{label}</Text>
      <FilterChipRow<T>
        chipSize="md"
        options={options}
        value={selected}
        onChange={(next) => next && onSelect(next)}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}
