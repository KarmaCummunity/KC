// @vitest-environment jsdom
// KC#1102 / KC#1111 — the hub's refine chips: items/food show their world subcategories (tap picks,
// "all" clears), other worlds show none, and the distance row reports the chosen radius. The
// chips are kit filter chips (spec 17 §4.1), announced with their checked state.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@kc/ui';

const listWorldSubcategories = vi.fn();

vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'he' } }) }));
vi.mock('../../../services/marketplaceComposition', () => ({
  marketplaceRepository: () => ({ listWorldSubcategories }),
}));

import { BrowseRefineChips, DEFAULT_BROWSE_RADIUS_KM } from '../BrowseRefineChips';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderChips(worldSlug: string | null, categoryId: string | null = null) {
  const onCategoryChange = vi.fn();
  const onRadiusChange = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
        <BrowseRefineChips
          worldSlug={worldSlug}
          categoryId={categoryId}
          onCategoryChange={onCategoryChange}
          radiusKm={DEFAULT_BROWSE_RADIUS_KM}
          onRadiusChange={onRadiusChange}
        />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { ...view, onCategoryChange, onRadiusChange };
}

describe('BrowseRefineChips', () => {
  it('lists the world subcategories, picks one and clears with "all"', async () => {
    listWorldSubcategories.mockResolvedValue([
      { categoryId: 'c-books', slug: 'books', labelHe: 'ספרים', labelEn: 'Books' },
      { categoryId: 'c-toys', slug: 'toys', labelHe: 'צעצועים', labelEn: 'Toys' },
    ]);
    const { findByTestId, getByTestId, onCategoryChange } = renderChips('items', 'c-toys');

    expect((await findByTestId('browse-refine-subcategory-toys')).getAttribute('aria-checked')).toBe('true');
    expect(getByTestId('browse-refine-subcategory-books').getAttribute('aria-checked')).toBe('false');
    fireEvent.click(getByTestId('browse-refine-subcategory-books'));
    expect(onCategoryChange).toHaveBeenLastCalledWith('c-books');
    fireEvent.click(getByTestId('browse-refine-subcategory-all'));
    expect(onCategoryChange).toHaveBeenLastCalledWith(null);
    expect(listWorldSubcategories).toHaveBeenCalledWith('items');
  });

  it('shows no subcategory row for a world without subcategories or with no world chosen', () => {
    for (const world of ['rides', null]) {
      const { queryByTestId, unmount } = renderChips(world);
      expect(queryByTestId('browse-refine-subcategory-all')).toBeNull();
      unmount();
    }
    expect(listWorldSubcategories).not.toHaveBeenCalled();
  });

  it('reports the chosen distance', () => {
    const { getByTestId, onRadiusChange } = renderChips(null);
    expect(getByTestId(`browse-refine-radius-${DEFAULT_BROWSE_RADIUS_KM}`).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(getByTestId('browse-refine-radius-10'));
    expect(onRadiusChange).toHaveBeenCalledWith(10);
  });
});
