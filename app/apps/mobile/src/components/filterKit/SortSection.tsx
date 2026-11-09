// Mapped to spec: FR-FEED-004 / FR-FEED-006 (shared sort section for filter sheets)
import React, { type ReactNode } from 'react';
import { View } from 'react-native';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { Chip } from '../ui/Chip';
import { ChipSelectRow } from './ChipSelectRow';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';

export interface SortOption<T> {
  readonly value: T;
  readonly label: string;
  readonly testID?: string;
}

export interface SortSectionProps<T> {
  readonly title?: string;
  readonly options: readonly SortOption<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly children?: ReactNode;
  readonly testID?: string;
}

export function SortSection<T extends string>({
  title,
  options,
  value,
  onChange,
  children,
  testID,
}: SortSectionProps<T>) {
  const styles = useSortSectionStyles();

  return (
    <View style={styles.section} testID={testID}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      <ChipSelectRow testID={testID}>
        {options.map((opt) => (
          <Chip
            size="sm"
            key={opt.value}
            testID={opt.testID ?? (testID ? `${testID}-${opt.value}` : undefined)}
            label={opt.label}
            selected={value === opt.value}
            onPress={() => onChange(opt.value)}
          />
        ))}
      </ChipSelectRow>
      {children}
    </View>
  );
}

const useSortSectionStyles = makeUseStyles(({ colors }) => ({
  section: { gap: spacing.xs, marginBottom: spacing.md },
  title: { ...typography.label, color: colors.textPrimary, textAlign: rtlTextAlignStart },
}));
