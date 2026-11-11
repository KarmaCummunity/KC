// @vitest-environment jsdom
// Mapped to spec: FR-POST-001 AC6 — the category picker is one scrolling row of chips (every
// giving world one tap away; the kit Chip, announced with its checked state), the direction toggle sits under it and is hidden for link worlds.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';

vi.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => <span data-testid={`icon-${name}`} />,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'he' } }) }));

import { UnifiedCreateHeader } from '../UnifiedCreateHeader';
import { CREATE_CATEGORIES } from '../../../lib/unifiedCreate/createCategories';

afterEach(cleanup);

function renderHeader(over: Partial<React.ComponentProps<typeof UnifiedCreateHeader>> = {}) {
  const props = {
    categories: CREATE_CATEGORIES,
    categoryId: 'food' as const,
    onCategoryChange: vi.fn(),
    showDirection: true,
    direction: 'give' as const,
    onDirectionChange: vi.fn(),
    ...over,
  };
  const view = render(
    <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
      <UnifiedCreateHeader {...props} />
    </ThemeProvider>,
  );
  return { view, props };
}

describe('UnifiedCreateHeader', () => {
  it('renders one chip per category', () => {
    const { view } = renderHeader();
    expect(view.getAllByRole('checkbox')).toHaveLength(CREATE_CATEGORIES.length);
    for (const c of CREATE_CATEGORIES) expect(view.getByTestId(`create-category-${c.id}`)).toBeTruthy();
  });

  it('marks only the selected category as checked', () => {
    const { view } = renderHeader({ categoryId: 'rides' });
    const checked = view.getAllByRole('checkbox').filter((el) => el.getAttribute('aria-checked') === 'true');
    expect(checked).toHaveLength(1);
    expect(checked[0]).toBe(view.getByTestId('create-category-rides'));
  });

  it('reports the tapped category', () => {
    const { view, props } = renderHeader();
    fireEvent.click(view.getByTestId('create-category-housing'));
    expect(props.onCategoryChange).toHaveBeenCalledWith('housing');
  });

  it('shows the direction toggle and hides it for link worlds', () => {
    const shown = renderHeader();
    expect(shown.view.getByTestId('create-direction-give')).toBeTruthy();
    expect(shown.view.getByTestId('create-direction-request')).toBeTruthy();
    cleanup();
    const hidden = renderHeader({ showDirection: false, categoryId: 'money' });
    expect(hidden.view.queryByTestId('create-direction-give')).toBeNull();
  });

  // #2058: both halves of the request / offer toggle must show the same solid "selected" fill,
  // so the chosen side is obvious whichever one it is. react-native-web turns styles into atomic
  // classes, so the fill is compared through its `r-backgroundColor-*` class.
  it('paints the selected side of the toggle with one shared fill, give or request', () => {
    const fill = (side: 'give' | 'request', selected: 'give' | 'request') => {
      const { view } = renderHeader({ direction: selected });
      const cls = (view.getByTestId(`create-direction-${side}`) as HTMLElement).className;
      cleanup();
      return /r-backgroundColor-\w+/.exec(cls)?.[0];
    };
    const giveSelected = fill('give', 'give');
    const requestSelected = fill('request', 'request');
    expect(giveSelected).toBeDefined();
    expect(requestSelected).toBe(giveSelected);
    // The unselected side carries no fill at all, so it reads clearly different.
    expect(fill('request', 'give')).toBeUndefined();
    expect(fill('give', 'request')).toBeUndefined();
  });
});
