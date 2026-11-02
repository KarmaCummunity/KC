// @vitest-environment jsdom
// #1412 — the listing publisher card shows the owner's city name from the cached city list.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';

const { listCities, language } = vi.hoisted(() => ({
  listCities: vi.fn(),
  language: { current: 'he' },
}));

vi.mock('../../services/userComposition', () => ({ listCities }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: language.current } }) }));

import { useCityName } from '../useCityName';

const CITIES = [
  { cityId: '5000', nameHe: 'תל אביב - יפו', nameEn: 'Tel Aviv - Yafo' },
  { cityId: '3000', nameHe: 'ירושלים', nameEn: '' },
];

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  listCities.mockResolvedValue(CITIES);
  language.current = 'he';
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('useCityName', () => {
  it('returns the Hebrew name of a known city', async () => {
    const { result } = renderHook(() => useCityName('5000'), { wrapper });
    await waitFor(() => expect(result.current).toBe('תל אביב - יפו'));
  });

  it('returns the English name in English, falling back to Hebrew when it is empty', async () => {
    language.current = 'en';
    const tlv = renderHook(() => useCityName('5000'), { wrapper });
    await waitFor(() => expect(tlv.result.current).toBe('Tel Aviv - Yafo'));
    const jlm = renderHook(() => useCityName('3000'), { wrapper });
    await waitFor(() => expect(jlm.result.current).toBe('ירושלים'));
  });

  it('returns null for an unknown city and does not load the list without an id', async () => {
    const unknown = renderHook(() => useCityName('9999'), { wrapper });
    await waitFor(() => expect(listCities).toHaveBeenCalledTimes(1));
    expect(unknown.result.current).toBeNull();

    listCities.mockClear();
    const none = renderHook(() => useCityName(null), { wrapper: ({ children }) => (
      <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
    ) });
    expect(none.result.current).toBeNull();
    expect(listCities).not.toHaveBeenCalled();
  });
});
