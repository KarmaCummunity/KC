// @vitest-environment jsdom
// FR-KNOW-004 AC1 (#2034) — the slot editor of a lesson or consulting hour writes `details.slots`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'he' } }) }));
vi.mock('react-native-reanimated', async () => (await import('../../ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('expo-haptics', async () => (await import('../../ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('@expo/vector-icons', async () => (await import('../../ui/__tests__/kitDialogTestKit')).iconsDouble);
// The date picker is not under test: a stub that reports its label and value.
vi.mock('../../ui/DateTimeField', () => ({
  DateTimeField: ({ testID }: { testID: string }) => <div data-testid={testID} />,
}));

import { KnowledgeSlotListField, nextSlotStart } from '../KnowledgeSlotListField';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderField(value: unknown, maxSlots = 20) {
  const onChange = vi.fn();
  const utils = render(
    <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
      <KnowledgeSlotListField value={value} onChange={onChange} maxSlots={maxSlots} />
    </ThemeProvider>,
  );
  return { ...utils, onChange };
}

const SLOT = { starts_at: '2030-01-02T16:00:00.000Z', ends_at: '2030-01-02T17:00:00.000Z' };

describe('KnowledgeSlotListField', () => {
  it('adds a first one-hour time', () => {
    const { getByTestId, onChange } = renderField(undefined);
    fireEvent.click(getByTestId('knowledge-slot-add'));
    const [next] = onChange.mock.calls[0]!;
    expect(next).toHaveLength(1);
    expect(Date.parse(next[0].ends_at) - Date.parse(next[0].starts_at)).toBe(60 * 60_000);
  });

  it('adds the next time a week after the latest', () => {
    const { getByTestId, onChange } = renderField([SLOT]);
    fireEvent.click(getByTestId('knowledge-slot-add'));
    const [next] = onChange.mock.calls[0]!;
    expect(next[1].starts_at).toBe('2030-01-09T16:00:00.000Z');
  });

  it('changes the length of a time and removes a time', () => {
    const { getByTestId, getAllByText, onChange } = renderField([SLOT]);
    fireEvent.click(getAllByText('knowledgeBooking.slotLength')[3]!); // 90 minutes
    expect(onChange.mock.calls[0]![0]).toEqual([{ starts_at: SLOT.starts_at, ends_at: '2030-01-02T17:30:00.000Z' }]);
    fireEvent.click(getByTestId('knowledge-slot-remove-0'));
    expect(onChange.mock.calls[1]![0]).toEqual([]);
  });

  it('stops offering "add" at the limit', () => {
    const { queryByTestId } = renderField([SLOT], 1);
    expect(queryByTestId('knowledge-slot-add')).toBeNull();
  });
});

describe('nextSlotStart', () => {
  it('starts the first time tomorrow at 18:00', () => {
    const start = nextSlotStart([], new Date(2030, 0, 1, 9, 30));
    expect([start.getDate(), start.getHours(), start.getMinutes()]).toEqual([2, 18, 0]);
  });
});
