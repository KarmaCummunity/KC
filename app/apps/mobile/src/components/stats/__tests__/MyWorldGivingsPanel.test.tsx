// @vitest-environment jsdom
// FR-STATS-008 — the member's own givings per world: one row per world with given / received /
// closed, an empty hint when nothing was handed over yet, and no query without a session.
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const m = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'he' } }) }));
vi.mock('../../../services/statsComposition', () => ({
  getListMyWorldGivingsUseCase: () => ({ execute: m.list }),
}));

import { renderInTheme } from '../../ui/__tests__/kitDialogTestKit';
import { MyWorldGivingsPanel } from '../MyWorldGivingsPanel';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderPanel(userId: string | undefined) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderInTheme(
    <QueryClientProvider client={client}>
      <MyWorldGivingsPanel userId={userId} />
    </QueryClientProvider>,
  );
}

describe('MyWorldGivingsPanel', () => {
  it('shows one row per world with the three counts', async () => {
    m.list.mockResolvedValue([
      { worldSlug: 'items', worldLabelHe: 'חפצים', worldLabelEn: 'Items', given: 2, received: 1, closed: 3 },
    ]);
    renderPanel('me');
    const row = await screen.findByTestId('my-world-givings-items');
    expect(row.textContent).toContain('חפצים');
    expect(row.textContent).toContain('2');
    expect(row.textContent).toContain('1');
    expect(row.textContent).toContain('3');
  });

  it('shows the empty hint when nothing was handed over yet', async () => {
    m.list.mockResolvedValue([]);
    renderPanel('me');
    await waitFor(() => expect(screen.getByText('stats.byWorldEmpty')).toBeTruthy());
  });

  it('does not query without a signed-in member', () => {
    renderPanel(undefined);
    expect(m.list).not.toHaveBeenCalled();
  });
});
