// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
});

import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';
import type { City } from '@kc/domain';

vi.mock('../../services/userComposition', () => ({
  listCities: vi.fn(),
}));

const refetchMock = vi.fn();
let mockQueryState = {
  data: [] as City[] | null,
  isLoading: false,
  error: null as Error | null,
  refetch: refetchMock,
};

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => mockQueryState,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

let passedPickerProps: Record<string, unknown> = {};
vi.mock('../SearchablePicker/SearchablePicker', () => ({
  SearchablePicker: (props: Record<string, unknown>) => {
    passedPickerProps = props;
    return <div data-testid="searchable-picker" />;
  },
}));

import { CityPicker } from '../CityPicker';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockQueryState = {
    data: [],
    isLoading: false,
    error: null,
    refetch: refetchMock,
  };
});

describe('CityPicker', () => {
  it('passes loaded cities and handles matching safely even with null fields', () => {
    const mockCities: City[] = [
      { cityId: '5000', nameHe: 'תל אביב - יפו', nameEn: 'Tel Aviv' },
      { cityId: '3000', nameHe: 'חיפה', nameEn: 'Haifa' },
      { cityId: '9999', nameHe: null as unknown as string, nameEn: null as unknown as string },
    ];
    mockQueryState.data = mockCities;

    const onChange = vi.fn();
    render(
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
        <CityPicker value={null} onChange={onChange} />
      </ThemeProvider>,
    );

    expect(passedPickerProps.items).toEqual(mockCities);
    const matchItem = passedPickerProps.matchItem as (item: City, query: string) => boolean;
    const renderRow = passedPickerProps.renderRow as (item: City) => { id: string; name: string };

    // Valid city matches
    expect(matchItem(mockCities[0], 'תל')).toBe(true);
    expect(matchItem(mockCities[0], 'tel')).toBe(true);
    expect(matchItem(mockCities[0], 'חיפה')).toBe(false);

    // City with null nameHe and null nameEn does not throw
    expect(matchItem(mockCities[2], 'query')).toBe(false);
    expect(matchItem(null as unknown as City, 'query')).toBe(false);

    // Rendering row does not throw
    expect(renderRow(mockCities[0])).toEqual({ id: '5000', name: 'תל אביב - יפו' });
    expect(renderRow(mockCities[2])).toEqual({ id: '9999', name: '' });
    expect(renderRow(null as unknown as City)).toEqual({ id: '', name: '' });
  });

  it('provides retry callback that triggers refetch on error', () => {
    mockQueryState.error = new Error('Failed to load cities');
    mockQueryState.data = null;

    render(
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
        <CityPicker value={null} onChange={vi.fn()} />
      </ThemeProvider>,
    );

    expect(passedPickerProps.error).toBe(mockQueryState.error);
    const onRetry = passedPickerProps.onErrorRetry as () => void;
    expect(typeof onRetry).toBe('function');
    onRetry();
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });
});
