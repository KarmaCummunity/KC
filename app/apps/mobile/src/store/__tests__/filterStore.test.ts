import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { LocationFilter } from '@kc/domain';

// Persist middleware writes to AsyncStorage which calls `window.*` on the web
// path — undefined in vitest's node env. Replace with an in-memory adapter
// so the store stays usable without spamming "ReferenceError: window".
vi.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    default: {
      getItem: (k: string) => Promise.resolve(store.get(k) ?? null),
      setItem: (k: string, v: string) => Promise.resolve(void store.set(k, v)),
      removeItem: (k: string) => Promise.resolve(void store.delete(k)),
    },
  };
});

import { useFilterStore } from '../filterStore';

// The store is a zustand singleton with persist middleware. We reset to the
// canonical default state before each test (using clearAll, which mirrors
// what the UI's "Reset" button does).

beforeEach(() => {
  useFilterStore.getState().clearAll();
});

const TLV_FILTER: LocationFilter = {
  centerCity: 'IL-001',
  centerCityName: 'Tel Aviv',
  radiusKm: 10,
};

describe('useFilterStore — defaults', () => {
  it('starts with all defaults (no filters active)', () => {
    const s = useFilterStore.getState();
    expect(s.type).toBeNull();
    expect(s.worlds).toEqual([]);
    expect(s.subcategories).toEqual([]);
    expect(s.categories).toEqual([]);
    expect(s.itemConditions).toEqual([]);
    expect(s.locationFilter).toBeNull();
    expect(s.statusFilter).toBe('open');
    expect(s.sortOrder).toBe('newest');
    expect(s.proximitySortCity).toBeNull();
    expect(s.proximitySortCityName).toBeNull();
    expect(s.followersOnly).toBe(false);
    expect(s.searchQuery).toBe('');
  });

  it('activeCount() returns 0 on default state (no filters tweaked)', () => {
    expect(useFilterStore.getState().activeCount()).toBe(0);
  });
});

describe('useFilterStore — setters', () => {
  it('setType updates type field only', () => {
    useFilterStore.getState().setType('Give');
    expect(useFilterStore.getState().type).toBe('Give');
    expect(useFilterStore.getState().categories).toEqual([]); // untouched
  });

  it('setWorlds and setSubcategories update array fields', () => {
    useFilterStore.getState().setWorlds(['items', 'food']);
    expect(useFilterStore.getState().worlds).toEqual(['items', 'food']);
    useFilterStore.getState().setSubcategories(['books', 'toys']);
    expect(useFilterStore.getState().subcategories).toEqual(['books', 'toys']);
  });

  it('setCategories replaces the array (not appends)', () => {
    useFilterStore.getState().setCategories(['Electronics']);
    useFilterStore.getState().setCategories(['Furniture', 'Books']);
    expect(useFilterStore.getState().categories).toEqual(['Furniture', 'Books']);
  });

  it('setProximitySortCity updates both id and name fields together', () => {
    useFilterStore.getState().setProximitySortCity('IL-001', 'Tel Aviv');
    expect(useFilterStore.getState().proximitySortCity).toBe('IL-001');
    expect(useFilterStore.getState().proximitySortCityName).toBe('Tel Aviv');
  });

  it('setLocationFilter accepts null to clear', () => {
    useFilterStore.getState().setLocationFilter(TLV_FILTER);
    useFilterStore.getState().setLocationFilter(null);
    expect(useFilterStore.getState().locationFilter).toBeNull();
  });

  it('setFollowersOnly toggles the FR-FEED-020 flag', () => {
    useFilterStore.getState().setFollowersOnly(true);
    expect(useFilterStore.getState().followersOnly).toBe(true);
    useFilterStore.getState().setFollowersOnly(false);
    expect(useFilterStore.getState().followersOnly).toBe(false);
  });
});

describe('useFilterStore — clearAll', () => {
  it('returns ALL fields to default after every kind of mutation', () => {
    const s = useFilterStore.getState();
    s.setType('Give');
    s.setCategories(['Electronics']);
    s.setItemConditions(['New']);
    s.setLocationFilter(TLV_FILTER);
    s.setStatusFilter('closed');
    s.setSortOrder('distance');
    s.setProximitySortCity('IL-001', 'Tel Aviv');
    s.setFollowersOnly(true);
    s.setSearchQuery('ספר');
    expect(useFilterStore.getState().activeCount()).toBe(9);

    useFilterStore.getState().clearAll();
    expect(useFilterStore.getState().activeCount()).toBe(0);
    expect(useFilterStore.getState()).toMatchObject({
      type: null,
      categories: [],
      itemConditions: [],
      locationFilter: null,
      statusFilter: 'open',
      sortOrder: 'newest',
      proximitySortCity: null,
      proximitySortCityName: null,
      followersOnly: false,
      searchQuery: '',
    });
  });
});

describe('useFilterStore — searchQuery (FR-FEED-003)', () => {
  it('activeCount includes searchQuery when trimmed length >= 2', () => {
    useFilterStore.getState().setSearchQuery('ab');
    expect(useFilterStore.getState().activeCount()).toBe(1);
    useFilterStore.getState().setSearchQuery('a');
    expect(useFilterStore.getState().activeCount()).toBe(0);
  });

  it('clearAll resets searchQuery', () => {
    useFilterStore.getState().setSearchQuery('ספרים');
    useFilterStore.getState().clearAll();
    expect(useFilterStore.getState().searchQuery).toBe('');
  });
});

describe('useFilterStore — activeCount() per dimension', () => {
  it('counts type=non-null as 1', () => {
    useFilterStore.getState().setType('Give');
    expect(useFilterStore.getState().activeCount()).toBe(1);
  });

  it('counts a non-empty categories array as 1 (single dimension, not 1-per-category)', () => {
    useFilterStore.getState().setCategories(['Electronics', 'Furniture', 'Books']);
    expect(useFilterStore.getState().activeCount()).toBe(1);
  });

  it('counts a non-empty itemConditions array as 1', () => {
    useFilterStore.getState().setItemConditions(['New', 'LikeNew']);
    expect(useFilterStore.getState().activeCount()).toBe(1);
  });

  it('counts a non-null locationFilter as 1', () => {
    useFilterStore.getState().setLocationFilter(TLV_FILTER);
    expect(useFilterStore.getState().activeCount()).toBe(1);
  });

  it('counts statusFilter as 1 only when different from default "open"', () => {
    useFilterStore.getState().setStatusFilter('open');
    expect(useFilterStore.getState().activeCount()).toBe(0);
    useFilterStore.getState().setStatusFilter('closed');
    expect(useFilterStore.getState().activeCount()).toBe(1);
    useFilterStore.getState().setStatusFilter('all');
    expect(useFilterStore.getState().activeCount()).toBe(1);
  });

  it('counts sortOrder as 1 only when different from default "newest"', () => {
    useFilterStore.getState().setSortOrder('newest');
    expect(useFilterStore.getState().activeCount()).toBe(0);
    useFilterStore.getState().setSortOrder('distance');
    expect(useFilterStore.getState().activeCount()).toBe(1);
    useFilterStore.getState().setSortOrder('oldest');
    expect(useFilterStore.getState().activeCount()).toBe(1);
  });

  it('counts proximitySortCity as 1 when non-null (ignoring the display name)', () => {
    useFilterStore.getState().setProximitySortCity('IL-001', 'Tel Aviv');
    expect(useFilterStore.getState().activeCount()).toBe(1);
  });

  it('counts followersOnly=true as 1 (FR-FEED-020)', () => {
    useFilterStore.getState().setFollowersOnly(true);
    expect(useFilterStore.getState().activeCount()).toBe(1);
  });

  it('counts worlds and subcategories as active filters', () => {
    useFilterStore.getState().setWorlds(['items']);
    expect(useFilterStore.getState().activeCount()).toBe(1);
    useFilterStore.getState().setSubcategories(['books']);
    expect(useFilterStore.getState().activeCount()).toBe(2);
  });

  it('all dimensions stack additively up to 11', () => {
    const s = useFilterStore.getState();
    s.setType('Request');
    s.setWorlds(['items']);
    s.setSubcategories(['books']);
    s.setCategories(['Books']);
    s.setItemConditions(['Good']);
    s.setLocationFilter(TLV_FILTER);
    s.setStatusFilter('all');
    s.setSortOrder('distance');
    s.setProximitySortCity('IL-001', 'Tel Aviv');
    s.setFollowersOnly(true);
    s.setSearchQuery('בקשה');
    expect(useFilterStore.getState().activeCount()).toBe(11);
  });
});

describe('useFilterStore — persisted state migration (v4 -> v5)', () => {
  it('safely migrates old v4 state by dropping categories and initializing worlds and subcategories', () => {
    const migrate = (
      useFilterStore as unknown as {
        persist: {
          getOptions: () => {
            migrate?: (persisted: unknown, version: number) => unknown;
          };
        };
      }
    ).persist.getOptions().migrate;
    const oldV4State = {
      type: 'Give',
      categories: ['Electronics', 'Books'],
      itemConditions: ['New'],
      locationFilter: TLV_FILTER,
      statusFilter: 'closed',
      sortOrder: 'distance',
      proximitySortCity: 'IL-001',
      proximitySortCityName: 'Tel Aviv',
      followersOnly: true,
      searchQuery: 'laptop',
    };

    expect(migrate).toBeDefined();
    const migrated = migrate!(oldV4State, 4);
    expect(migrated).toMatchObject({
      type: 'Give',
      worlds: [],
      subcategories: [],
      categories: [],
      itemConditions: ['New'],
      locationFilter: TLV_FILTER,
      statusFilter: 'closed',
      sortOrder: 'distance',
      proximitySortCity: 'IL-001',
      proximitySortCityName: 'Tel Aviv',
      followersOnly: true,
      searchQuery: 'laptop',
    });
  });
  it('falls back to defaults when the persisted state is not an object', () => {
    const migrate = (
      useFilterStore as unknown as {
        persist: { getOptions: () => { migrate?: (persisted: unknown, version: number) => unknown } };
      }
    ).persist.getOptions().migrate;
    expect(migrate!(null, 4)).toMatchObject({ worlds: [], subcategories: [], statusFilter: 'open' });
    expect(migrate!({}, 4)).toMatchObject({
      type: null, worlds: [], subcategories: [], itemConditions: [], locationFilter: null,
      statusFilter: 'open', sortOrder: 'newest', proximitySortCity: null,
      proximitySortCityName: null, followersOnly: false, searchQuery: '',
    });
    expect(migrate!({ worlds: ['food'], subcategories: ['bakery'] }, 5)).toMatchObject({
      worlds: ['food'], subcategories: ['bakery'],
    });
  });
});
