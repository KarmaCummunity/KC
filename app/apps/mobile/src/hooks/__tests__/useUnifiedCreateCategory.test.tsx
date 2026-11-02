// @vitest-environment jsdom
// FR-POST-001 AC1 / AC6 — the create form reopens on the last used category + direction,
// a `?category=` deep link wins over it, and every change is remembered.
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostType } from '@kc/domain';
import { ThemeProvider } from '@kc/ui';

const mocks = vi.hoisted(() => ({
  params: {} as { category?: string | string[]; direction?: string | string[] },
  load: vi.fn(),
  save: vi.fn(),
}));

vi.mock('expo-router', () => ({ useLocalSearchParams: () => mocks.params }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'he' } }) }));
vi.mock('../../lib/unifiedCreate/createPreferencesStorage', () => ({
  loadCreatePreferences: mocks.load,
  saveCreatePreferences: mocks.save,
}));

import { useUnifiedCreateCategory } from '../useUnifiedCreateCategory';

/** Renders the hook's header and exposes its state as text. */
function Harness() {
  const [type, setType] = useState<PostType>('Give');
  const { activeCategory, direction, header, ready } = useUnifiedCreateCategory('u1', type, setType);
  return (
    <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
      {header}
      <span data-testid="state">{ready ? `${activeCategory.id}/${direction}` : 'loading'}</span>
    </ThemeProvider>
  );
}

async function renderHarness() {
  await act(async () => {
    render(<Harness />);
  });
}

const state = () => screen.getByTestId('state').textContent;

beforeEach(() => {
  mocks.params = {};
  mocks.load.mockResolvedValue({ categoryId: 'rides', direction: 'request' });
  mocks.save.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('useUnifiedCreateCategory', () => {
  it('reopens on the remembered category and direction', async () => {
    await renderHarness();
    expect(mocks.load).toHaveBeenCalledWith('u1');
    expect(state()).toBe('rides/request');
  });

  it('a deep link wins and skips the stored choice', async () => {
    mocks.params = { category: 'food' };
    await renderHarness();
    expect(mocks.load).not.toHaveBeenCalled();
    expect(state()).toBe('food/give');
  });

  it('a deep link with a direction presets request / offer (FR-FEED-020 AC2)', async () => {
    mocks.params = { category: 'food', direction: 'request' };
    await renderHarness();
    expect(mocks.load).not.toHaveBeenCalled();
    expect(state()).toBe('food/request');
  });

  it('ignores a bad direction in a deep link and keeps the form direction', async () => {
    mocks.params = { category: 'time', direction: 'sideways' };
    await renderHarness();
    expect(state()).toBe('time/give');
  });

  it('ignores a direction without a known category', async () => {
    mocks.params = { category: 'knowledge', direction: 'give' };
    await renderHarness();
    expect(state()).toBe('rides/request');
  });

  it('an unknown deep link falls back to the remembered choice', async () => {
    mocks.params = { category: ['knowledge'] };
    await renderHarness();
    expect(state()).toBe('rides/request');
  });

  it('remembers a category change together with the current direction', async () => {
    await renderHarness();
    fireEvent.click(screen.getByTestId('create-category-housing'));
    expect(state()).toBe('housing/request');
    expect(mocks.save).toHaveBeenLastCalledWith('u1', { categoryId: 'housing', direction: 'request' });
  });

  it('remembers a direction change together with the current category', async () => {
    await renderHarness();
    fireEvent.click(screen.getByTestId('create-direction-give'));
    expect(state()).toBe('rides/give');
    expect(mocks.save).toHaveBeenLastCalledWith('u1', { categoryId: 'rides', direction: 'give' });
  });

  it('renders the five category tiles in order, the active one selected', async () => {
    await renderHarness();
    const tiles = screen.getAllByRole('radio');
    expect(tiles.map((t) => t.getAttribute('data-testid'))).toEqual([
      'create-category-items',
      'create-category-rides',
      'create-category-food',
      'create-category-housing',
      'create-category-time',
    ]);
    expect(screen.getByTestId('create-category-rides').getAttribute('aria-checked')).toBe('true');
  });
});
