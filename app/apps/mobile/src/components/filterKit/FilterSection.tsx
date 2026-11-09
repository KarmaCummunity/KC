// Mapped to spec: FR-FEED-004 (shared filter section with title and chip row)
import React from 'react';
import { View } from 'react-native';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import {
  FilterChipRow,
  type FilterOption,
  type SingleFilterChipRowProps,
  type MultiFilterChipRowProps,
} from './FilterChipRow';

export type { FilterOption };

interface SectionTitleProp {
  readonly title?: string;
}

export type SingleFilterSectionProps<T> = SingleFilterChipRowProps<T> & SectionTitleProp;
export type MultiFilterSectionProps<T> = MultiFilterChipRowProps<T> & SectionTitleProp;
export type FilterSectionProps<T> = SingleFilterSectionProps<T> | MultiFilterSectionProps<T>;

export function FilterSection<T extends string | number>(props: FilterSectionProps<T>) {
  const styles = useFilterSectionStyles();
  const { title, testID, showAllChip = true } = props;

  return (
    <View style={styles.section} testID={testID}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      <FilterChipRow
        {...props}
        testID={undefined}
        testIDPrefix={testID}
        showAllChip={showAllChip}
      />
    </View>
  );
}

const useFilterSectionStyles = makeUseStyles(({ colors }) => ({
  section: { gap: spacing.xs, marginBottom: spacing.md },
  title: { ...typography.label, color: colors.textPrimary, textAlign: rtlTextAlignStart },
}));
