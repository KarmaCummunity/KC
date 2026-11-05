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
  flags: undefined as Record<string, boolean> | undefined,
}));
vi.mock('../useLaunchWorldFlags', () => ({ useRemoteAppFlags: () => mocks.flags }));

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
  mocks.flags = undefined;
  mocks.load.mockResolvedValue({ categoryId: 'rides', directions: { rides: 'request', food: 'request' } });
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

  it('a deep link wins over the remembered category but opens in that category\'s own direction', async () => {
    mocks.params = { category: 'food' };
    await renderHarness();
    expect(state()).toBe('food/request');
  });

  it('a deep link to a category never used opens as an offer', async () => {
    mocks.params = { category: 'housing' };
    await renderHarness();
    expect(state()).toBe('housing/give');
  });

  it('a deep link with a direction presets request / offer (FR-FEED-020 AC2)', async () => {
    mocks.params = { category: 'food', direction: 'give' };
    await renderHarness();
    expect(state()).toBe('food/give');
  });

  it('ignores a bad direction in a deep link and keeps the form direction', async () => {
    mocks.params = { category: 'time', direction: 'sideways' };
    await renderHarness();
    expect(state()).toBe('time/give');
  });

  it('ignores a direction without a known category', async () => {
    mocks.params = { category: 'bogus', direction: 'give' };
    await renderHarness();
    expect(state()).toBe('rides/request');
  });

  it('an unknown deep link falls back to the remembered choice', async () => {
    mocks.params = { category: ['bogus'] };
    await renderHarness();
    expect(state()).toBe('rides/request');
  });

  it('switching category reopens it in the direction last used there', async () => {
    await renderHarness();
    fireEvent.click(screen.getByTestId('create-category-food'));
    expect(state()).toBe('food/request');
    fireEvent.click(screen.getByTestId('create-category-housing'));
    expect(state()).toBe('housing/give');
    expect(mocks.save).toHaveBeenLastCalledWith('u1', {
      categoryId: 'housing',
      directions: { rides: 'request', food: 'request' },
    });
  });

  it('remembers a direction change for that category only', async () => {
    await renderHarness();
    fireEvent.click(screen.getByTestId('create-direction-give'));
    expect(state()).toBe('rides/give');
    expect(mocks.save).toHaveBeenLastCalledWith('u1', {
      categoryId: 'rides',
      directions: { rides: 'give', food: 'request' },
    });
  });

  it('hides the request / offer toggle for a link-only world', async () => {
    await renderHarness();
    expect(screen.queryByTestId('create-direction-give')).not.toBeNull();
    fireEvent.click(screen.getByTestId('create-category-medical'));
    expect(state()).toBe('medical/give');
    expect(screen.queryByTestId('create-direction-give')).toBeNull();
  });

  it('keeps knowledge a link-only world until it is launched, then offers request / offer (#1630)', async () => {
    mocks.params = { category: 'knowledge' };
    await renderHarness();
    expect(screen.queryByTestId('create-direction-give')).toBeNull();
    cleanup();
    mocks.flags = { world_knowledge_enabled: true };
    await renderHarness();
    expect(state()).toBe('knowledge/give');
    expect(screen.queryByTestId('create-direction-give')).not.toBeNull();
  });

  it('renders one chip per giving world in order, the active one selected', async () => {
    await renderHarness();
    const tiles = screen
      .getAllByRole('checkbox')
      .filter((t) => (t.getAttribute('data-testid') ?? '').startsWith('create-category-'));
    expect(tiles.map((t) => t.getAttribute('data-testid'))).toEqual([
      ...['items', 'food', 'rides', 'time', 'money', 'housing', 'knowledge', 'medical', 'animals', 'democracy', 'employment', 'challenges'].map(
        (id) => `create-category-${id}`,
      ),
    ]);
    expect(screen.getByTestId('create-category-rides').getAttribute('aria-checked')).toBe('true');
  });
});
