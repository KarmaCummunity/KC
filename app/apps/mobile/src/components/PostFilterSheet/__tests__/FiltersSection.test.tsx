// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorldSubcategory } from '@kc/domain';

const { listWorldSubcategories } = vi.hoisted(() => ({ listWorldSubcategories: vi.fn() }));

vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

vi.mock('../../../services/marketplaceComposition', () => ({
  marketplaceRepository: () => ({ listWorldSubcategories }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: 'he' },
  }),
}));

import { FiltersSection, type FiltersSectionProps } from '../FiltersSection';

const BOOKS: WorldSubcategory = { categoryId: 'c-books', slug: 'books', labelHe: 'ספרים', labelEn: 'Books' };
const TOYS: WorldSubcategory = { categoryId: 'c-toys', slug: 'toys', labelHe: 'צעצועים', labelEn: 'Toys' };
const BAKERY: WorldSubcategory = { categoryId: 'c-bakery', slug: 'bakery', labelHe: 'מאפייה', labelEn: 'Bakery' };

function renderFiltersSection(props: Partial<FiltersSectionProps> = {}) {
  const onTypeChange = vi.fn();
  const onWorldChange = vi.fn();
  const onWorldsChange = vi.fn();
  const onSubcategoriesChange = vi.fn();
  const onItemConditionsChange = vi.fn();
  const onStatusFilterChange = vi.fn();
  const onFollowersOnlyChange = vi.fn();

  const utils = render(
    <FiltersSection
      type={null}
      worlds={[]}
      subcategories={[]}
      itemConditions={[]}
      statusFilter="open"
      followersOnly={false}
      onTypeChange={onTypeChange}
      onWorldChange={onWorldChange}
      onWorldsChange={onWorldsChange}
      onSubcategoriesChange={onSubcategoriesChange}
      onItemConditionsChange={onItemConditionsChange}
      onStatusFilterChange={onStatusFilterChange}
      onFollowersOnlyChange={onFollowersOnlyChange}
      {...props}
    />,
  );

  return {
    ...utils,
    onTypeChange,
    onWorldChange,
    onWorldsChange,
    onSubcategoriesChange,
    onItemConditionsChange,
    onStatusFilterChange,
    onFollowersOnlyChange,
  };
}

describe('FiltersSection — world and subcategory behavior', () => {
  beforeEach(() => {
    listWorldSubcategories.mockImplementation(async (worldSlug: string) => {
      if (worldSlug === 'items') return [BOOKS, TOYS];
      if (worldSlug === 'food') return [BAKERY];
      return [];
    });
  });

  afterEach(() => {
    cleanup();
    listWorldSubcategories.mockReset();
  });

  it('renders world chips with an All chip and does not show subcategories initially', () => {
    renderFiltersSection({ worlds: [] });

    expect(screen.getByTestId('filters-worlds-all')).toBeTruthy();
    expect(screen.getByTestId('world-chip-items')).toBeTruthy();
    expect(screen.getByTestId('world-chip-food')).toBeTruthy();
    expect(screen.getByTestId('world-chip-rides')).toBeTruthy();

    expect(screen.queryByTestId('filters-subcategories')).toBeNull();
  });

  it('selecting a world reveals subcategories loaded via listWorldSubcategories', async () => {
    const { onWorldChange, onWorldsChange, onSubcategoriesChange, rerender } =
      renderFiltersSection({ worlds: [] });

    fireEvent.click(screen.getByTestId('world-chip-items'));
    expect(onWorldChange).toHaveBeenCalledWith('items');
    expect(onWorldsChange).toHaveBeenCalledWith(['items']);
    expect(onSubcategoriesChange).toHaveBeenCalledWith([]);

    await act(async () => {
      rerender(
        <FiltersSection
          type={null}
          worlds={['items']}
          subcategories={[]}
          itemConditions={[]}
          statusFilter="open"
          followersOnly={false}
          onTypeChange={vi.fn()}
          onWorldChange={onWorldChange}
          onWorldsChange={onWorldsChange}
          onSubcategoriesChange={onSubcategoriesChange}
          onItemConditionsChange={vi.fn()}
          onStatusFilterChange={vi.fn()}
          onFollowersOnlyChange={vi.fn()}
        />,
      );
    });

    expect(listWorldSubcategories).toHaveBeenCalledWith('items');
    expect(screen.getByTestId('filters-subcategories')).toBeTruthy();
    expect(screen.getByTestId('subcategory-chip-books')).toBeTruthy();
    expect(screen.getByTestId('subcategory-chip-toys')).toBeTruthy();
  });

  it('changing world clears subcategories', async () => {
    const onWorldChange = vi.fn();
    const onWorldsChange = vi.fn();
    const onSubcategoriesChange = vi.fn();

    let rerenderFn!: ReturnType<typeof render>['rerender'];
    await act(async () => {
      const utils = render(
        <FiltersSection
          type={null}
          worlds={['items']}
          subcategories={['books']}
          itemConditions={[]}
          statusFilter="open"
          followersOnly={false}
          onTypeChange={vi.fn()}
          onWorldChange={onWorldChange}
          onWorldsChange={onWorldsChange}
          onSubcategoriesChange={onSubcategoriesChange}
          onItemConditionsChange={vi.fn()}
          onStatusFilterChange={vi.fn()}
          onFollowersOnlyChange={vi.fn()}
        />,
      );
      rerenderFn = utils.rerender;
    });

    expect(screen.getByTestId('subcategory-chip-books')).toBeTruthy();

    // Click another world ('food')
    fireEvent.click(screen.getByTestId('world-chip-food'));
    expect(onWorldChange).toHaveBeenCalledWith('food');
    expect(onWorldsChange).toHaveBeenCalledWith(['food']);
    expect(onSubcategoriesChange).toHaveBeenCalledWith([]);

    // Update props to food
    await act(async () => {
      rerenderFn(
        <FiltersSection
          type={null}
          worlds={['food']}
          subcategories={[]}
          itemConditions={[]}
          statusFilter="open"
          followersOnly={false}
          onTypeChange={vi.fn()}
          onWorldChange={onWorldChange}
          onWorldsChange={onWorldsChange}
          onSubcategoriesChange={onSubcategoriesChange}
          onItemConditionsChange={vi.fn()}
          onStatusFilterChange={vi.fn()}
          onFollowersOnlyChange={vi.fn()}
        />,
      );
    });

    expect(listWorldSubcategories).toHaveBeenCalledWith('food');
    expect(screen.getByTestId('subcategory-chip-bakery')).toBeTruthy();
    expect(screen.queryByTestId('subcategory-chip-books')).toBeNull();
  });

  it('item condition row is shown only when world is items or none and type is Give', () => {
    const { rerender } = renderFiltersSection({ type: 'Give', worlds: ['items'] });
    expect(screen.getByTestId('filters-condition')).toBeTruthy();

    rerender(
      <FiltersSection
        type="Give"
        worlds={[]}
        subcategories={[]}
        itemConditions={[]}
        statusFilter="open"
        followersOnly={false}
        onTypeChange={vi.fn()}
        onItemConditionsChange={vi.fn()}
        onStatusFilterChange={vi.fn()}
        onFollowersOnlyChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('filters-condition')).toBeTruthy();

    rerender(
      <FiltersSection
        type="Give"
        worlds={['food']}
        subcategories={[]}
        itemConditions={[]}
        statusFilter="open"
        followersOnly={false}
        onTypeChange={vi.fn()}
        onItemConditionsChange={vi.fn()}
        onStatusFilterChange={vi.fn()}
        onFollowersOnlyChange={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('filters-condition')).toBeNull();

    rerender(
      <FiltersSection
        type="Request"
        worlds={['items']}
        subcategories={[]}
        itemConditions={[]}
        statusFilter="open"
        followersOnly={false}
        onTypeChange={vi.fn()}
        onItemConditionsChange={vi.fn()}
        onStatusFilterChange={vi.fn()}
        onFollowersOnlyChange={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('filters-condition')).toBeNull();
  });
});
