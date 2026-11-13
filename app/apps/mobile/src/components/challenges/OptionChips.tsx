import React from 'react';
import { FilterChipRow } from '../filterKit/FilterChipRow';
import { FormSection } from '../ui/FormSection';

export interface ChipOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

interface OptionChipsProps<T extends string> {
  readonly label: string;
  readonly options: ReadonlyArray<ChipOption<T>>;
  readonly selected: T | null;
  readonly onSelect: (value: T) => void;
  /** Explains the selected option (shown under the label). */
  readonly hint?: string;
  readonly testID?: string;
}

/** A labelled single-choice row of chips (one sideways-scrolling line), used by the "open a challenge" form. */
export function OptionChips<T extends string>({ label, options, selected, onSelect, hint, testID }: OptionChipsProps<T>) {
  return (
    <FormSection label={label} hint={hint} testID={testID}>
      <FilterChipRow<T> chipSize="md" options={options} value={selected} onChange={(next) => next && onSelect(next)} />
    </FormSection>
  );
}
