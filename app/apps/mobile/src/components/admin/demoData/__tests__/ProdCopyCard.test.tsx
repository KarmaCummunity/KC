// @vitest-environment jsdom
// FR-ADMIN-037 AC13 — the "Copied from production" card: hidden where the tools do not exist
// (kc-prod), the counts and the time of the last copy, the empty state, and "Delete copied data"
// behind a confirmation.
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@kc/ui';
import { DemoDataError, type ProdCopyStatus } from '@kc/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Reanimated does not transform under Vitest; the buttons' press animation is not under test here.
vi.mock('react-native-reanimated', async () => {
  const { View } = await vi.importActual<typeof import('react-native')>('react-native');
  return {
    default: { View },
    useSharedValue: (value: number) => ({ value }),
    useAnimatedStyle: () => ({}),
    withSpring: (value: number) => value,
    withTiming: (value: number) => value,
  };
});
vi.mock('../../../../lib/haptics', () => ({ hapticLightImpact: () => {} }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('../../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'en' } }) }));

const { getStatus, deleteAll, confirm } = vi.hoisted(() => ({
  getStatus: vi.fn<() => Promise<ProdCopyStatus>>(),
  deleteAll: vi.fn(),
  confirm: vi.fn<() => Promise<boolean>>(),
}));
vi.mock('../../../../lib/container', () => ({
  container: { getProdCopyStatus: { execute: getStatus }, deleteProdCopy: { execute: deleteAll } },
}));
vi.mock('../../../../services/platformConfirm', () => ({ confirmAction: confirm }));
vi.mock('../../../../i18n/useLocaleBundle', () => ({
  useLocaleBundle: () => ({
    admin: {
      demoData: {
        errors: { generic: 'ERR', forbidden: 'FORBIDDEN', notInstalled: 'NOT-INSTALLED' },
        prodCopy: {
          title: 'TITLE', subtitle: 'SUB', members: 'M', posts: 'P', organizations: 'O', follows: 'F', savedPosts: 'S',
          lastCopied: (when: string) => `LAST ${when}`, neverCopied: 'NEVER', empty: 'EMPTY',
          deleteButton: 'DELETE', deleting: 'DELETING', confirmTitle: 'SURE?',
          confirmBody: (m: number, p: number) => `BODY ${m}/${p}`, confirmOk: 'OK', confirmCancel: 'NO',
          deleted: (m: number, p: number, o: number) => `DELETED ${m}/${p}/${o}`,
        },
      },
    },
  }),
}));

import { ProdCopyCard } from '../ProdCopyCard';

const STATUS: ProdCopyStatus = {
  members: 200, posts: 685, organizations: 3, follows: 1600, savedPosts: 400, lastCopiedAt: '2026-11-21T20:45:00Z',
};

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
        <ProdCopyCard />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getStatus.mockReset();
  deleteAll.mockReset();
  confirm.mockReset();
});
afterEach(() => cleanup());

describe('ProdCopyCard (FR-ADMIN-037 AC13)', () => {
  it('shows nothing where the copy tools are not installed (kc-prod)', async () => {
    getStatus.mockRejectedValue(new DemoDataError('not_installed'));
    const { container } = renderCard();
    await waitFor(() => expect(getStatus).toHaveBeenCalled());
    await waitFor(() => expect(container.textContent).toBe(''));
  });

  it('shows the counts and when the last copy ran', async () => {
    getStatus.mockResolvedValue(STATUS);
    renderCard();
    expect(await screen.findByText('685')).toBeTruthy();
    expect(screen.getByText('1600')).toBeTruthy();
    expect(screen.getByTestId('admin-prod-copy-last').textContent).toMatch(/^LAST .*2026/);
  });

  it('says when nothing was copied yet and offers no delete', async () => {
    getStatus.mockResolvedValue({ ...STATUS, members: 0, posts: 0, organizations: 0, follows: 0, savedPosts: 0, lastCopiedAt: null });
    renderCard();
    expect(await screen.findByText('EMPTY')).toBeTruthy();
    expect(screen.getByTestId('admin-prod-copy-last').textContent).toBe('NEVER');
    expect(screen.queryByTestId('admin-prod-copy-delete')).toBeNull();
  });

  it('deletes only after the confirmation, and reports what was deleted', async () => {
    getStatus.mockResolvedValue(STATUS);
    deleteAll.mockResolvedValue({ members: 200, posts: 685, organizations: 3 });
    confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    renderCard();
    fireEvent.click(await screen.findByTestId('admin-prod-copy-delete'));
    await waitFor(() => expect(confirm).toHaveBeenCalledWith('SURE?', 'BODY 200/685', expect.objectContaining({ destructive: true })));
    expect(deleteAll).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('admin-prod-copy-delete'));
    expect(await screen.findByText('DELETED 200/685/3')).toBeTruthy();
    expect(deleteAll).toHaveBeenCalledTimes(1);
  });
});
