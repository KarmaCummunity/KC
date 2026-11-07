// @vitest-environment jsdom
// Sheets on the kit `BottomSheet` (spec 17 §4.1.1, TD-243): the feed filter
// (FR-FEED-004), the search filter (FR-FEED-017) and the photo source picker
// (FR-AUTH-011) render their content and actions and dismiss through `onClose`;
// the filter chips are compact (`sm`) kit `Chip` checkboxes (D99).
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';

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
vi.mock('expo-haptics', () => ({ impactAsync: () => Promise.resolve(), ImpactFeedbackStyle: { Light: 'light' } }));
vi.mock('@expo/vector-icons', () => ({
  Ionicons: ({ name }: { name: string }) => <span data-testid={`icon-${name}`} />,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock('../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('../../hooks/useModalHardwareBack', () => ({ useModalHardwareBack: () => {} }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));
// The city picker loads cities from the network; a placeholder is enough here.
vi.mock('../CityPicker', () => ({ CityPicker: () => <span data-testid="city-picker" /> }));
vi.mock('../../services/marketplaceComposition', () => ({
  marketplaceRepository: () => ({
    listWorldSubcategories: async () => [],
  }),
}));
vi.mock('../../services/avatarUpload', () => ({ isCameraAvailable: true }));

import { RADIUS_OPTIONS_KM } from '@kc/domain';
import { PostFilterSheet, type PostFilterValue } from '../PostFilterSheet';
import { SearchFilterSheet } from '../SearchFilterSheet';
import { PhotoSourceSheet } from '../PhotoSourceSheet';
import { useSearchStore } from '../../store/searchStore';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const withTheme = (ui: React.ReactElement) =>
  render(<ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>{ui}</ThemeProvider>);

/** Filter-sheet chips use the kit's compact `sm` size: 28pt tall (44pt touch target via `hitSlop`). */
function expectCompactChips(chips: HTMLElement[]) {
  expect(chips.length).toBeGreaterThan(0);
  for (const chip of chips) expect(getComputedStyle(chip).minHeight).toBe('28px');
}

const FEED_FILTER: PostFilterValue = {
  type: null,
  worlds: [],
  subcategories: [],
  categories: [],
  itemConditions: [],
  locationFilter: null,
  statusFilter: 'open',
  sortOrder: 'newest',
  proximitySortCity: null,
  proximitySortCityName: null,
  followersOnly: false,
  searchQuery: '',
};

describe('PostFilterSheet', () => {
  function renderSheet(visible = true, value: PostFilterValue = FEED_FILTER) {
    const handlers = { onPatch: vi.fn(), onClear: vi.fn(), onClose: vi.fn() };
    const view = withTheme(<PostFilterSheet visible={visible} value={value} {...handlers} />);
    return { ...view, ...handlers };
  }

  it('renders the titled sheet with its sections', () => {
    const { getByRole, getByText } = renderSheet();
    expect(getByRole('heading').textContent).toBe('filters.header');
    expect(getByText('filters.sectionSort')).toBeTruthy();
  });

  it('renders nothing while closed', () => {
    const { queryByText } = renderSheet(false);
    expect(queryByText('filters.header')).toBeNull();
  });

  it('shows feed settings link only on the home feed sheet', () => {
    const onOpenFeedSettings = vi.fn();
    const home = withTheme(
      <PostFilterSheet
        visible
        value={FEED_FILTER}
        onPatch={vi.fn()}
        onClear={vi.fn()}
        onClose={vi.fn()}
        onOpenFeedSettings={onOpenFeedSettings}
      />,
    );
    fireEvent.click(home.getByTestId('feed-filter-open-settings'));
    expect(onOpenFeedSettings).toHaveBeenCalledOnce();
    home.unmount();

    const world = withTheme(
      <PostFilterSheet
        visible
        value={FEED_FILTER}
        onPatch={vi.fn()}
        onClear={vi.fn()}
        onClose={vi.fn()}
        lockedWorld
        onOpenFeedSettings={onOpenFeedSettings}
      />,
    );
    expect(world.queryByTestId('feed-filter-open-settings')).toBeNull();
  });

  it('commits a chip change to the parent', () => {
    const { getByText, onPatch } = renderSheet();
    fireEvent.click(getByText('filters.statusClosedOnly'));
    expect(onPatch).toHaveBeenCalledWith({ statusFilter: 'closed' });
  });

  it('shows the applied filters as checked kit chips', () => {
    const { getByRole } = renderSheet();
    expect(getByRole('checkbox', { name: 'filters.statusOpenOnly' }).getAttribute('aria-checked')).toBe('true');
    expect(getByRole('checkbox', { name: 'filters.statusClosedOnly' }).getAttribute('aria-checked')).toBe('false');
    expect(getByRole('checkbox', { name: 'filters.sortNewest' }).getAttribute('aria-checked')).toBe('true');
  });

  it('checks the current radius and commits a new one from the radius chips', () => {
    const locationFilter = { centerCity: 'haifa', centerCityName: 'Haifa', radiusKm: RADIUS_OPTIONS_KM[0] };
    const { getAllByRole, onPatch } = renderSheet(true, { ...FEED_FILTER, locationFilter });
    // The mocked `t` drops the {{km}} value, so the radius chips share one name; order follows RADIUS_OPTIONS_KM.
    const radiusChips = getAllByRole('checkbox', { name: 'filters.radiusKm' });
    expect(radiusChips.map((chip) => chip.getAttribute('aria-checked'))).toEqual(
      RADIUS_OPTIONS_KM.map((km) => String(km === RADIUS_OPTIONS_KM[0])),
    );
    fireEvent.click(radiusChips[1]);
    expect(onPatch).toHaveBeenCalledWith({ locationFilter: { ...locationFilter, radiusKm: RADIUS_OPTIONS_KM[1] } });
  });

  it('renders every filter chip, radius included, in the compact size', () => {
    const locationFilter = { centerCity: 'haifa', centerCityName: 'Haifa', radiusKm: RADIUS_OPTIONS_KM[0] };
    const { getAllByRole } = renderSheet(true, { ...FEED_FILTER, type: 'Give', locationFilter });
    expectCompactChips(getAllByRole('checkbox'));
  });

  it('dismisses through onClose from the close control', () => {
    const { getByRole, onClose, onClear } = renderSheet();
    fireEvent.click(getByRole('button', { name: 'general.close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClear).not.toHaveBeenCalled();
  });

  it('clears every filter and closes from the footer action', () => {
    const { getByRole, onClose, onClear } = renderSheet();
    fireEvent.click(getByRole('button', { name: 'filters.clearAll' }));
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('SearchFilterSheet', () => {
  it('renders its filter chips in the compact size', () => {
    useSearchStore.getState().clearFilters();
    const { getAllByRole } = withTheme(<SearchFilterSheet visible onClose={vi.fn()} />);
    expectCompactChips(getAllByRole('checkbox'));
  });

  it('applies the previewed filters to the store, then closes', () => {
    useSearchStore.getState().clearFilters();
    const onClose = vi.fn();
    const { getByRole } = withTheme(<SearchFilterSheet visible onClose={onClose} />);
    expect(getByRole('heading').textContent).toBe('search.filters');
    fireEvent.click(getByRole('checkbox', { name: 'search.give' }));
    expect(useSearchStore.getState().postType).toBeNull();
    fireEvent.click(getByRole('button', { name: 'search.applyFilters' }));
    expect(useSearchStore.getState().postType).toBe('Give');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('dismisses through onClose without applying', () => {
    useSearchStore.getState().clearFilters();
    const onClose = vi.fn();
    const { getByRole } = withTheme(<SearchFilterSheet visible onClose={onClose} />);
    fireEvent.click(getByRole('checkbox', { name: 'search.request' }));
    fireEvent.click(getByRole('button', { name: 'general.close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(useSearchStore.getState().postType).toBeNull();
  });
});

describe('PhotoSourceSheet', () => {
  function renderSheet(canRemove: boolean) {
    const handlers = { onPick: vi.fn(), onRemove: vi.fn(), onClose: vi.fn() };
    const view = withTheme(<PhotoSourceSheet visible canRemove={canRemove} {...handlers} />);
    return { ...view, ...handlers };
  }

  it('offers camera, gallery and remove under its title', () => {
    const { getByRole, onPick, onRemove } = renderSheet(true);
    expect(getByRole('heading').textContent).toBe('profile.photoSourceTitle');
    fireEvent.click(getByRole('button', { name: 'profile.photoSourceCameraA11y' }));
    fireEvent.click(getByRole('button', { name: 'profile.photoSourceGalleryA11y' }));
    fireEvent.click(getByRole('button', { name: 'profile.photoSourceRemoveA11y' }));
    expect(onPick.mock.calls).toEqual([['camera'], ['gallery']]);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('hides remove when there is no photo', () => {
    const { queryByRole } = renderSheet(false);
    expect(queryByRole('button', { name: 'profile.photoSourceRemoveA11y' })).toBeNull();
  });

  it('dismisses through onClose from cancel and the close control', () => {
    const { getByRole, onClose } = renderSheet(false);
    fireEvent.click(getByRole('button', { name: 'general.cancel' }));
    fireEvent.click(getByRole('button', { name: 'general.close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
