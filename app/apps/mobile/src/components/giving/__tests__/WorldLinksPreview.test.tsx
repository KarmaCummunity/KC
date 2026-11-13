// @vitest-environment jsdom
// FR-FEED-020 AC2 — the end of a world's feed: a short list of the world's links and a button
// to its "links and knowledge" screen.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';
import type { DonationLink } from '@kc/domain';

const mocks = vi.hoisted(() => ({ push: vi.fn(), open: vi.fn(), links: [] as DonationLink[] }));

vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('../../../utils/openExternalUrl', () => ({ openExternalUrl: mocks.open }));
vi.mock('../../../hooks/useWorldLinksPreview', () => ({ useWorldLinksPreview: () => mocks.links }));
vi.mock('../../ui/Buttons', () => ({
  SecondaryButton: (p: { label: string; testID?: string; onPress: () => void }) => (
    <button data-testid={p.testID} onClick={p.onPress}>{p.label}</button>
  ),
}));

import { WorldLinksPreview } from '../WorldLinksPreview';

const link = (id: string): DonationLink => ({
  id, categorySlug: 'food', url: `https://${id}.example`, displayName: `Name ${id}`, description: null,
  submittedBy: null, validatedAt: '2026-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z',
  reviewStatus: 'approved', reviewNote: null,
});

const show = (worldSlug: string) =>
  render(<ThemeProvider mode="light" systemScheme="light" setMode={() => {}}><WorldLinksPreview worldSlug={worldSlug} /></ThemeProvider>);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.links = [];
});

describe('WorldLinksPreview', () => {
  it('lists the links, opens one in the browser and leads to the full screen', () => {
    mocks.links = [link('a'), link('b')];
    const view = show('food');
    const rows = view.getAllByTestId('world-links-preview-row');
    expect(rows.map((row) => row.textContent)).toEqual(['Name a', 'Name b']);
    expect(view.queryByText('donations.worldContent.previewHint')).toBeNull();

    fireEvent.click(rows[1]!);
    expect(mocks.open).toHaveBeenCalledWith('https://b.example');

    fireEvent.click(view.getByTestId('world-links-open-all'));
    expect(mocks.push).toHaveBeenCalledWith('/(tabs)/donations/food/links');
  });

  it('still offers the full screen, with a hint, when the world has no link to preview', () => {
    const view = show('items');
    expect(view.queryAllByTestId('world-links-preview-row')).toHaveLength(0);
    expect(view.getByText('donations.worldContent.previewHint')).toBeTruthy();
    fireEvent.click(view.getByTestId('world-links-open-all'));
    expect(mocks.push).toHaveBeenCalledWith('/(tabs)/donations/items/links');
  });
});
