// @vitest-environment jsdom
// Mapped to spec: FR-IMPORT-010 AC4 — the admin statistics show the import funnel of the period and
// the edit rate of each draft field; an empty period says so; a failed read leaves the section out.
import React from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@kc/ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendUnavailableError } from '@kc/domain';
import { localeBundle } from '../../../i18n/useLocaleBundle';

const execute = vi.hoisted(() => vi.fn());
vi.mock('../../../services/importComposition', () => ({ getImportTelemetryUseCase: () => ({ execute }) }));
// The hook form subscribes to language changes through react-i18next; the plain accessor is enough here.
vi.mock('../../../i18n/useLocaleBundle', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../i18n/useLocaleBundle')>();
  return { ...actual, useLocaleBundle: () => actual.localeBundle() };
});

import { AdminImportTelemetry } from '../AdminImportTelemetry';

const FUNNEL = { attempts: 6, manual: 1, drafted: 5, published: 3, discarded: 1, providerCalls: 3 };

function renderSection(days = 30) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
        <AdminImportTelemetry days={days} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  execute.mockReset();
});
afterEach(cleanup);

describe('AdminImportTelemetry', () => {
  it('shows the funnel and the edit rate per field of the period', async () => {
    execute.mockResolvedValue({
      funnel: FUNNEL,
      fieldEditRates: [
        { field: 'title', reported: 2, edited: 1, editRate: 0.5 },
        { field: 'city', reported: 2, edited: 0, editRate: 0 },
        { field: 'mystery', reported: 2, edited: 2, editRate: 1 },
      ],
    });
    const view = renderSection(7);
    await waitFor(() => expect(view.getByTestId('admin-stats-imports')).toBeTruthy());
    expect(execute).toHaveBeenCalledWith(7);
    expect(view.getByTestId('admin-stats-imports-attempts').textContent).toContain('6');
    expect(view.getByTestId('admin-stats-imports-discarded').textContent).toContain('1');
    expect(view.getByTestId('admin-stats-imports-rate-title').textContent).toContain('50%');
    expect(view.getByTestId('admin-stats-imports-rate-city').textContent).toContain('0%');
    // A field the screen has no words for is left out rather than shown raw.
    expect(view.queryByTestId('admin-stats-imports-rate-mystery')).toBeNull();
  });

  it('an empty period says so and shows no numbers', async () => {
    execute.mockResolvedValue({ funnel: { ...FUNNEL, attempts: 0 }, fieldEditRates: [] });
    const view = renderSection();
    await waitFor(() => expect(view.getByText(localeBundle().admin.stats.imports.empty)).toBeTruthy());
    expect(view.queryByTestId('admin-stats-imports-attempts')).toBeNull();
  });

  it('a backend without the import functions leaves the section out', async () => {
    execute.mockImplementation(async () => {
      throw new BackendUnavailableError('rpc:admin_import_funnel', 'function');
    });
    const view = renderSection();
    await waitFor(() => expect(execute).toHaveBeenCalled());
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(view.queryByTestId('admin-stats-imports')).toBeNull();
  });
});
