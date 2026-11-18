// Mapped to spec: FR-RESP-006 AC31 — a calendar day in an admin form: picked, never typed, and kept
// as `YYYY-MM-DD` in local time (`lib/localDay`), so it never moves by the UTC offset.
import React from 'react';
import { DateTimeField } from '../ui/DateTimeField';
import { FormSection } from '../ui/FormSection';
import { dateToLocalDay, localDayToDate } from '../../lib/localDay';

export interface AdminDateFieldProps {
  readonly label: string;
  /** `YYYY-MM-DD`, or '' while no day is picked. */
  readonly value: string;
  readonly onChange: (day: string) => void;
  readonly disabled?: boolean;
  readonly testID?: string;
}

export function AdminDateField({ label, value, onChange, disabled, testID }: AdminDateFieldProps) {
  return (
    <FormSection label={label} outlined={false}>
      <DateTimeField
        label={label}
        mode="date"
        value={localDayToDate(value)}
        onChange={(date) => onChange(dateToLocalDay(date))}
        disabled={disabled}
        testID={testID}
      />
    </FormSection>
  );
}
