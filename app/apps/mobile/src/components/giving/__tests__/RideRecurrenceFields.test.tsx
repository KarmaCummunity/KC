// @vitest-environment jsdom
// FR-RIDE-046 — the "recurring ride" block of the create form: off by default, the switch
// starts a draft on the departure's weekday, days toggle, the end date can be set and cleared.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React, { useState } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o?.time ? `${k}:${String(o.time)}` : k), i18n: { language: 'he' } }),
}));
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
// The native switch does not fire `onValueChange` from a DOM click; a button stands in for it.
vi.mock('react-native', async () => {
  const actual = await vi.importActual<typeof import('react-native')>('react-native');
  const Switch = (p: { testID: string; value: boolean; onValueChange: (on: boolean) => void }) => (
    <button data-testid={p.testID} onClick={() => p.onValueChange(!p.value)} />
  );
  return { ...actual, Switch };
});
// The real field opens native pickers; here one button picks a fixed day.
vi.mock('../../ui/DateTimeField', () => ({
  DateTimeField: (p: { testID: string; mode: string; value: Date | null; onChange: (d: Date) => void }) => (
    <button data-testid={`${p.testID}-pick`} data-mode={p.mode} data-value={p.value?.toISOString() ?? ''} onClick={() => p.onChange(new Date(2026, 11, 31))} />
  ),
}));

import { RideRecurrenceFields, initialRecurrenceDraft, type RideRecurrenceDraft } from '../RideRecurrenceFields';

afterEach(cleanup);

// Monday 2026-11-02 at 07:30 local time.
const DEPARTS = new Date(2026, 10, 2, 7, 30);

function Harness({ initial = null, departsAt = DEPARTS }: { initial?: RideRecurrenceDraft | null; departsAt?: Date | null }) {
  const [value, setValue] = useState<RideRecurrenceDraft | null>(initial);
  return (
    <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
      <RideRecurrenceFields value={value} onChange={setValue} departsAt={departsAt} />
      <output data-testid="draft">{JSON.stringify(value)}</output>
    </ThemeProvider>
  );
}

const read = (view: ReturnType<typeof render>) => JSON.parse(view.getByTestId('draft').textContent ?? 'null');

describe('RideRecurrenceFields', () => {
  it('is off by default and starts on the departure weekday when switched on', () => {
    const view = render(<Harness />);
    expect(view.queryByTestId('ride-weekday-picker')).toBeNull();
    fireEvent.click(view.getByTestId('ride-recurrence-switch'));
    expect(read(view)).toEqual({ weekdays: [1], endsOn: null });
    expect(view.getByTestId('ride-weekday-picker')).toBeTruthy();
    expect(view.getByText('rideSeries.publishHint:07:30')).toBeTruthy();
  });

  it('toggles weekdays, keeping them in week order', () => {
    const view = render(<Harness initial={{ weekdays: [1], endsOn: null }} />);
    fireEvent.click(view.getByTestId('ride-weekday-0'));
    fireEvent.click(view.getByTestId('ride-weekday-4'));
    expect(read(view).weekdays).toEqual([0, 1, 4]);
    fireEvent.click(view.getByTestId('ride-weekday-1'));
    expect(read(view).weekdays).toEqual([0, 4]);
  });

  it('sets and clears the end date with a day-only picker', () => {
    const view = render(<Harness initial={{ weekdays: [1], endsOn: null }} />);
    expect(view.getByTestId('ride-series-ends-on-pick').getAttribute('data-mode')).toBe('date');
    fireEvent.click(view.getByTestId('ride-series-ends-on-pick'));
    expect(read(view).endsOn).toBe(new Date(2026, 11, 31).toISOString());
    fireEvent.click(view.getByTestId('ride-series-ends-on-clear'));
    expect(read(view).endsOn).toBeNull();
  });

  it('switching off drops the draft; a fresh draft without a departure has no days yet', () => {
    const view = render(<Harness initial={{ weekdays: [1, 2], endsOn: null }} departsAt={null} />);
    expect(view.getByText('rideSeries.departureHint')).toBeTruthy();
    fireEvent.click(view.getByTestId('ride-recurrence-switch'));
    expect(read(view)).toBeNull();
    expect(initialRecurrenceDraft(null)).toEqual({ weekdays: [], endsOn: null });
  });
});
