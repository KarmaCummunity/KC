// @vitest-environment jsdom
// FR-ADMIN-012 AC5 — the inbox row flags a case that has waited 12 h (warning) or 24 h (overdue)
// and shows nothing for a fresh one, so the admin sees at a glance what the store-review window needs.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';
import type { ReportInboxRow } from '@kc/domain';

vi.mock('expo-router', () => ({ router: { push: vi.fn() } }));

import { ReportRow } from '../ReportRow';

const NOW = new Date('2026-11-04T12:00:00.000Z');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const rowFiledHoursAgo = (hours: number): ReportInboxRow => ({
  targetType: 'post',
  targetId: '11111111-2222-3333-4444-555555555555',
  reporterCount: 1,
  oldestAt: new Date(NOW.getTime() - hours * 3_600_000).toISOString(),
  latestReporterId: null,
  target: { preview: 'Bookshelf' },
});

const renderRow = (hours: number) =>
  render(
    <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
      <ReportRow row={rowFiledHoursAgo(hours)} />
    </ThemeProvider>,
  );

describe('ReportRow SLA badge', () => {
  it('shows no badge for a case under 12 h old', () => {
    const { queryByTestId } = renderRow(3);
    expect(queryByTestId('report-sla-badge-warning')).toBeNull();
    expect(queryByTestId('report-sla-badge-overdue')).toBeNull();
  });

  it('shows a warning badge from 12 h', () => {
    const { getByTestId } = renderRow(13);
    expect(getByTestId('report-sla-badge-warning')).toBeTruthy();
  });

  it('shows an overdue badge from 24 h', () => {
    const { getByTestId } = renderRow(30);
    expect(getByTestId('report-sla-badge-overdue')).toBeTruthy();
  });
});
