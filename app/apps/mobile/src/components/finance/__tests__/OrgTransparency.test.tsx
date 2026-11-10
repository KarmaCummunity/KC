// @vitest-environment jsdom
// FR-FIN-022 — the public transparency card renders exactly the blocks the server sent, and the
// section stays invisible unless the organization published something.
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { HIDDEN_TRANSPARENCY, type OrgTransparency } from '@kc/domain';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    // Keys stand in for copy; interpolated values are appended so they can be asserted.
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && 'percent' in opts ? `${key}:${String(opts.percent)}` : key,
    i18n: { language: 'he' },
  }),
}));

const hook = vi.hoisted(() => ({ data: undefined as unknown }));
vi.mock('../../../hooks/useOrgTransparency', () => ({ useOrgTransparency: () => ({ data: hook.data }) }));

import { renderInTheme } from '../../ui/__tests__/kitDialogTestKit';
import { OrgTransparencySection } from '../OrgTransparencySection';
import { TransparencyView, hasTransparencyContent } from '../TransparencyView';

afterEach(cleanup);

const ON: OrgTransparency = { ...HIDDEN_TRANSPARENCY, enabled: true };

describe('hasTransparencyContent', () => {
  it('is false when enabled but every block is empty', () => {
    expect(hasTransparencyContent(ON)).toBe(false);
    expect(hasTransparencyContent({ ...ON, byCategory: [], monthly: [] })).toBe(false);
  });

  it('is true as soon as any block has data', () => {
    expect(hasTransparencyContent({ ...ON, donationsCount: 0 })).toBe(true);
    expect(hasTransparencyContent({ ...ON, programRatio: 0.5 })).toBe(true);
  });
});

describe('TransparencyView', () => {
  it('renders only the totals block when only totals were sent', () => {
    renderInTheme(
      <TransparencyView data={{ ...ON, totals: { incomeCents: 100000, expenseCents: 40000, netCents: 60000 } }} />,
    );
    expect(screen.getByText('transparency.income')).toBeTruthy();
    expect(screen.getByText('transparency.expense')).toBeTruthy();
    expect(screen.getByText('transparency.net')).toBeTruthy();
    expect(screen.queryByText('transparency.categoriesTitle')).toBeNull();
    expect(screen.queryByText('transparency.monthlyTitle')).toBeNull();
    expect(screen.queryByText('transparency.programRatioTitle')).toBeNull();
  });

  it('renders every block, with the program ratio as a rounded percent', () => {
    renderInTheme(
      <TransparencyView
        data={{
          ...ON,
          totals: { incomeCents: 100000, expenseCents: 50000, netCents: 50000 },
          donationsCount: 7,
          programRatio: 0.8,
          byCategory: [{ key: 'program', cents: 40000 }, { key: 'unknown_key', cents: 10000 }],
          monthly: [{ month: '2026-11', incomeCents: 100000, expenseCents: 50000 }],
          lastEntryAt: new Date('2026-11-02T10:00:00.000Z'),
        }}
      />,
    );
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByText('transparency.programRatioBody:80')).toBeTruthy();
    expect(screen.getByText('transparency.category.program')).toBeTruthy();
    expect(screen.getByText('transparency.monthlyTitle')).toBeTruthy();
    expect(screen.getByText('transparency.updatedAt')).toBeTruthy();
  });
});

describe('OrgTransparencySection', () => {
  it('renders nothing while loading, when hidden, or when enabled but empty', () => {
    for (const data of [undefined, HIDDEN_TRANSPARENCY, ON]) {
      hook.data = data;
      const { container } = renderInTheme(<OrgTransparencySection />);
      expect(container.querySelector('[data-testid="org-transparency"]')).toBeNull();
      cleanup();
    }
  });

  it('renders the card when something is published', () => {
    hook.data = { ...ON, donationsCount: 3 };
    const { container } = renderInTheme(<OrgTransparencySection />);
    expect(container.querySelector('[data-testid="org-transparency"]')).not.toBeNull();
  });
});
