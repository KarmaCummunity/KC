// Mapped to spec: FR-FEED-004 / FR-FEED-020 (shared horizontal/wrapping filter chip row)
import React from 'react';
import { ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing } from '@kc/ui';
import { Chip } from '../ui/Chip';

export interface FilterOption<T> {
  readonly value: T;
  readonly label: string;
  readonly testID?: string;
  readonly accessibilityLabel?: string;
}

interface BaseFilterChipRowProps<T> {
  readonly options: readonly FilterOption<T>[];
  readonly allLabel?: string;
  readonly showAllChip?: boolean;
  readonly scrollable?: boolean;
  readonly chipSize?: 'sm' | 'md';
  readonly testID?: string;
  readonly testIDPrefix?: string;
  readonly style?: StyleProp<ViewStyle>;
  readonly contentContainerStyle?: StyleProp<ViewStyle>;
  readonly accessibilityLabel?: string;
  readonly children?: React.ReactNode;
}

export interface SingleFilterChipRowProps<T> extends BaseFilterChipRowProps<T> {
  readonly multiSelect?: false;
  readonly value: T | null;
  readonly onChange: (next: T | null) => void;
}

export interface MultiFilterChipRowProps<T> extends BaseFilterChipRowProps<T> {
  readonly multiSelect: true;
  readonly value: readonly T[];
  readonly onChange: (next: T[]) => void;
}

export type FilterChipRowProps<T> = SingleFilterChipRowProps<T> | MultiFilterChipRowProps<T>;

function toggleInArray<T>(arr: readonly T[], value: T): T[] {
  return arr.includes(value) ? arr.filter((x) => x !== value) : [...arr, value];
}

export function FilterChipRow<T extends string | number>(props: FilterChipRowProps<T>) {
  const { t } = useTranslation();
  const styles = useFilterChipRowStyles();
  const {
    options,
    allLabel,
    showAllChip = false,
    scrollable = false,
    chipSize = 'sm',
    testID,
    testIDPrefix,
    style,
    contentContainerStyle,
    accessibilityLabel,
  } = props;

  const chipPrefix = testIDPrefix ?? testID;
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

  const chips = (
    <>
      {showAllChip && (
        <Chip
          size={chipSize}
          testID={chipPrefix ? `${chipPrefix}-all` : undefined}
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
            size={chipSize}
            key={String(opt.value)}
            testID={opt.testID ?? (chipPrefix ? `${chipPrefix}-${opt.value}` : undefined)}
            label={opt.label}
            selected={selected}
            onPress={() => handleOptionPress(opt.value)}
            accessibilityLabel={opt.accessibilityLabel}
          />
        );
      })}
      {props.children}
    </>
  );

  if (scrollable) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.scroll, style]}
        contentContainerStyle={[styles.scrollContent, contentContainerStyle]}
        testID={testID}
        accessibilityLabel={accessibilityLabel}
      >
        {chips}
      </ScrollView>
    );
  }

  return (
    <View
      style={[styles.wrapRow, style]}
      testID={testID}
      accessibilityLabel={accessibilityLabel}
    >
      {chips}
    </View>
  );
}

const useFilterChipRowStyles = makeUseStyles(() => ({
  scroll: { flexGrow: 0, flexShrink: 0 },
  scrollContent: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm },
  wrapRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
}));
