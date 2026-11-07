// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
});

import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';
import type { Street } from '@kc/domain';

const invalidateQueriesMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: [
      { streetId: 101, nameHe: 'דיזנגוף', cityId: '5000' },
      { streetId: 102, nameHe: null as unknown as string, cityId: '5000' },
    ] as Street[],
    isLoading: false,
    error: null,
  }),
  useQueryClient: () => ({
    invalidateQueries: invalidateQueriesMock,
  }),
}));

vi.mock('../../services/userComposition', () => ({
  listStreets: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const toastMock = vi.fn();
vi.mock('../../store/feedSessionStore', () => ({
  useFeedSessionStore: {
    getState: () => ({
      showEphemeralToast: toastMock,
    }),
  },
}));

let passedPickerProps: Record<string, unknown> = {};
vi.mock('../SearchablePicker/SearchablePicker', () => ({
  SearchablePicker: (props: Record<string, unknown>) => {
    passedPickerProps = props;
    return <div data-testid="street-searchable-picker" />;
  },
}));

import { StreetPicker } from '../StreetPicker';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('StreetPicker', () => {
  it('handles null cityId, disabled press toast, and safe matching', () => {
    const onChange = vi.fn();
    render(
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
        <StreetPicker cityId={null} value={null} onChange={onChange} />
      </ThemeProvider>,
    );

    expect(passedPickerProps.disabled).toBe(true);
    const onDisabledPress = passedPickerProps.onDisabledPress as () => void;
    onDisabledPress();
    expect(toastMock).toHaveBeenCalledWith('profile.streetPickerNeedCity', 'error', 2500);

    const matchItem = passedPickerProps.matchItem as (item: Street, query: string) => boolean;
    const renderRow = passedPickerProps.renderRow as (item: Street) => { id: string; name: string };

    const streets: Street[] = [
      { streetId: 101, nameHe: 'דיזנגוף', cityId: '5000' },
      { streetId: 102, nameHe: null as unknown as string, cityId: '5000' },
    ];

    expect(matchItem(streets[0], 'דיז')).toBe(true);
    expect(matchItem(streets[0], 'אבן')).toBe(false);
    // null nameHe or null item does not throw
    expect(matchItem(streets[1], 'דיז')).toBe(false);
    expect(matchItem(null as unknown as Street, 'דיז')).toBe(false);

    // renderRow safe rendering
    expect(renderRow(streets[0])).toEqual({ id: '101', name: 'דיזנגוף' });
    expect(renderRow(streets[1])).toEqual({ id: '102', name: '' });
    expect(renderRow(null as unknown as Street)).toEqual({ id: '', name: '' });
  });

  it('triggers query invalidation on error retry when cityId is present', () => {
    render(
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
        <StreetPicker cityId="5000" value={null} onChange={vi.fn()} />
      </ThemeProvider>,
    );

    const onErrorRetry = passedPickerProps.onErrorRetry as () => void;
    expect(typeof onErrorRetry).toBe('function');
    onErrorRetry();
    expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ['streets', '5000'] });
  });
});
