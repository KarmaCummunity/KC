// @vitest-environment jsdom
// KC#1296 — the create form's world subcategory chips: load per world, pick, clear, hide when empty.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock factories are hoisted above imports, so their spies must be hoisted too.
const { listWorldSubcategories } = vi.hoisted(() => ({ listWorldSubcategories: vi.fn() }));

vi.mock('../../../services/marketplaceComposition', () => ({
  marketplaceRepository: () => ({ listWorldSubcategories }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'he' } }),
}));

import { WorldSubcategoryPicker } from '../WorldSubcategoryPicker';

const BOOKS = { categoryId: 'c-books', slug: 'books', labelHe: 'ספרים', labelEn: 'Books' };
const TOYS = { categoryId: 'c-toys', slug: 'toys', labelHe: 'משחקים', labelEn: null };

/** Renders the picker and lets the subcategory load settle. */
async function renderPicker(value: string | null, onChange = vi.fn()) {
  await act(async () => {
    render(<WorldSubcategoryPicker worldSlug="items" value={value} onChange={onChange} />);
  });
  return onChange;
}

describe('WorldSubcategoryPicker', () => {
  beforeEach(() => listWorldSubcategories.mockResolvedValue([BOOKS, TOYS]));
  // Vitest config sets `globals: false`, so testing-library's automatic cleanup is not wired.
  afterEach(() => {
    cleanup();
    listWorldSubcategories.mockReset();
  });

  it('loads the world\'s subcategories and shows them in Hebrew', async () => {
    await renderPicker(null);
    expect(listWorldSubcategories).toHaveBeenCalledWith('items');
    expect(screen.getByText('ספרים')).toBeTruthy();
    expect(screen.getByText('משחקים')).toBeTruthy();
    expect(screen.getByText('marketplace.fieldWorldSubcategory')).toBeTruthy();
  });

  it('picks a subcategory, and tapping the selected one clears it', async () => {
    const pick = await renderPicker(null);
    fireEvent.click(screen.getByTestId('world-subcategory-books'));
    expect(pick).toHaveBeenLastCalledWith('c-books');

    cleanup();
    const clear = await renderPicker('c-books');
    fireEvent.click(screen.getByTestId('world-subcategory-books'));
    expect(clear).toHaveBeenLastCalledWith(null);
  });

  it('renders nothing when the world has no subcategories', async () => {
    listWorldSubcategories.mockResolvedValue([]);
    await renderPicker(null);
    expect(screen.queryByText('marketplace.fieldWorldSubcategory')).toBeNull();
  });
});
