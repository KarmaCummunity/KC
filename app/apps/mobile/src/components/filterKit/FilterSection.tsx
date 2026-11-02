// Mapped to spec: FR-FEED-004 (shared filter section with title and chip row)
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { Chip } from '../ui/Chip';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';

export interface FilterOption<T> {
  readonly value: T;
  readonly label: string;
  readonly testID?: string;
}

interface BaseFilterSectionProps<T> {
  readonly title: string;
  readonly options: readonly FilterOption<T>[];
  readonly allLabel?: string;
  readonly showAllChip?: boolean;
  readonly testID?: string;
}

export interface SingleFilterSectionProps<T> extends BaseFilterSectionProps<T> {
  readonly multiSelect?: false;
  readonly value: T | null;
  readonly onChange: (next: T | null) => void;
}

export interface MultiFilterSectionProps<T> extends BaseFilterSectionProps<T> {
  readonly multiSelect: true;
  readonly value: readonly T[];
  readonly onChange: (next: T[]) => void;
}

export type FilterSectionProps<T> = SingleFilterSectionProps<T> | MultiFilterSectionProps<T>;

function toggleInArray<T>(arr: readonly T[], value: T): T[] {
  return arr.includes(value) ? arr.filter((x) => x !== value) : [...arr, value];
}

export function FilterSection<T extends string | number>(props: FilterSectionProps<T>) {
  const { t } = useTranslation();
  const styles = useFilterSectionStyles();
  const {
    title,
    options,
    allLabel,
    showAllChip = true,
    testID,
  } = props;
  const resolvedAllLabel = allLabel ?? t('filters.all');

  const isAllSelected = props.multiSelect
    ? !props.value || props.value.length === 0
    : props.value === null;

  const handleAllPress = () => {
    if (props.multiSelect) {
      props.onChange([]);
    } else {
      props.onChange(null);
    }
  };

  const handleOptionPress = (optionValue: T) => {
    if (props.multiSelect) {
      props.onChange(toggleInArray(props.value ?? [], optionValue));
    } else {
      props.onChange(optionValue);
    }
  };

  return (
    <View style={styles.section} testID={testID}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.row}>
        {showAllChip && (
          <Chip
            size="sm"
            testID={testID ? `${testID}-all` : undefined}
            label={resolvedAllLabel}
            selected={isAllSelected}
            onPress={handleAllPress}
          />
        )}
        {options.map((opt) => {
          const selected = props.multiSelect
            ? (props.value ?? []).includes(opt.value)
            : props.value === opt.value;
          return (
            <Chip
              size="sm"
              key={String(opt.value)}
              testID={opt.testID ?? (testID ? `${testID}-${opt.value}` : undefined)}
              label={opt.label}
              selected={selected}
              onPress={() => handleOptionPress(opt.value)}
            />
          );
        })}
      </View>
    </View>
  );
}

const useFilterSectionStyles = makeUseStyles(({ colors }) => ({
  section: { gap: spacing.xs, marginBottom: spacing.md },
  title: { ...typography.label, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'flex-end' },
}));
