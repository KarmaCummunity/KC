// @vitest-environment jsdom
// Admin filter and choice chips on the kit `Chip` (spec 17 §4.1 / §4.1.1, TD-243):
// the list-screen filters (FR-ADMIN-018) and the grant / change-role choices (FR-ADMIN-030)
// are checkboxes that report their selection and pass presses through.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';

vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import { AdminFilterChip } from '../AdminFilterChip';
import { ChoiceChips } from '../admins/ChoiceChips';

afterEach(cleanup);

const withTheme = (ui: React.ReactElement) =>
  render(<ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>{ui}</ThemeProvider>);

describe('AdminFilterChip', () => {
  it('is a compact checkbox that reports `active` and calls onPress', () => {
    const onPress = vi.fn();
    const { getByRole } = withTheme(
      <>
        <AdminFilterChip label="All" active onPress={onPress} />
        <AdminFilterChip label="Income" active={false} onPress={() => {}} />
      </>,
    );
    const all = getByRole('checkbox', { name: 'All' });
    expect(all.getAttribute('aria-checked')).toBe('true');
    expect(getByRole('checkbox', { name: 'Income' }).getAttribute('aria-checked')).toBe('false');
    expect(getComputedStyle(all).minHeight).toBe('28px');
    fireEvent.click(all);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('ChoiceChips', () => {
  const OPTIONS = [
    { key: null, label: 'Platform' },
    { key: 'org-1', label: 'Org one' },
  ] as const;

  function renderChoices(selected: string | null | undefined) {
    const onSelect = vi.fn();
    const view = withTheme(<ChoiceChips options={OPTIONS} selected={selected} onSelect={onSelect} />);
    return { ...view, onSelect };
  }

  it('checks only the selected option, including the `null` key', () => {
    const { getByRole } = renderChoices(null);
    expect(getByRole('checkbox', { name: 'Platform' }).getAttribute('aria-checked')).toBe('true');
    expect(getByRole('checkbox', { name: 'Org one' }).getAttribute('aria-checked')).toBe('false');
  });

  it('checks nothing before a choice is made', () => {
    const { getAllByRole } = renderChoices(undefined);
    expect(getAllByRole('checkbox').map((chip) => chip.getAttribute('aria-checked'))).toEqual(['false', 'false']);
  });

  it('reports the pressed option key', () => {
    const { getByRole, onSelect } = renderChoices(null);
    fireEvent.click(getByRole('checkbox', { name: 'Org one' }));
    fireEvent.click(getByRole('checkbox', { name: 'Platform' }));
    expect(onSelect.mock.calls).toEqual([['org-1'], [null]]);
  });
});
