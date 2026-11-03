import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  Category,
  FeedSortOrder,
  FeedStatusFilter,
  ItemCondition,
  LocationFilter,
  PostType,
} from '@kc/domain';

// Mapped to: FR-FEED-003 (text search), FR-FEED-004 (filter modal),
// FR-FEED-005 (persisted state), FR-FEED-020 (followers-only feed scope).
// State is saved per signed-in user via AsyncStorage so reopening the app
// restores their last filter set.

export interface FilterState {
  type: PostType | null;
  worlds: string[];                       // giving world slugs; empty = all worlds
  subcategories: string[];                // world subcategory slugs; empty = all subcategories
  categories: Category[];                 // legacy item categories, kept unused for migration
  itemConditions: ItemCondition[];        // empty = no condition filter; only meaningful for Give
  locationFilter: LocationFilter | null;  // null = no location filter
  statusFilter: FeedStatusFilter;
  sortOrder: FeedSortOrder;
  proximitySortCity: string | null;       // null = use viewer's city
  proximitySortCityName: string | null;   // display name; UI-only — for re-hydrating the city picker
  followersOnly: boolean;                 // FR-FEED-020 — restrict to people I follow
  searchQuery: string;                    // FR-FEED-003 — raw input; active when trim length >= 2

  setType: (t: PostType | null) => void;
  setWorlds: (w: string[]) => void;
  setSubcategories: (s: string[]) => void;
  setCategories: (c: Category[]) => void;
  setItemConditions: (i: ItemCondition[]) => void;
  setLocationFilter: (f: LocationFilter | null) => void;
  setStatusFilter: (s: FeedStatusFilter) => void;
  setSortOrder: (s: FeedSortOrder) => void;
  setProximitySortCity: (id: string | null, name: string | null) => void;
  setFollowersOnly: (v: boolean) => void;
  setSearchQuery: (q: string) => void;
  clearAll: () => void;
  activeCount: () => number;
}

export const DEFAULT_STATE = {
  type: null as PostType | null,
  worlds: [] as string[],
  subcategories: [] as string[],
  categories: [] as Category[],
  itemConditions: [] as ItemCondition[],
  locationFilter: null as LocationFilter | null,
  statusFilter: 'open' as FeedStatusFilter,
  sortOrder: 'newest' as FeedSortOrder,
  proximitySortCity: null as string | null,
  proximitySortCityName: null as string | null,
  followersOnly: false,
  searchQuery: '',
};

export const useFilterStore = create<FilterState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_STATE,

      setType: (type) => set({ type }),
      setWorlds: (worlds) => set({ worlds }),
      setSubcategories: (subcategories) => set({ subcategories }),
      setCategories: (categories) => set({ categories }),
      setItemConditions: (itemConditions) => set({ itemConditions }),
      setLocationFilter: (locationFilter) => set({ locationFilter }),
      setStatusFilter: (statusFilter) => set({ statusFilter }),
      setSortOrder: (sortOrder) => set({ sortOrder }),
      setProximitySortCity: (id, name) =>
        set({ proximitySortCity: id, proximitySortCityName: name }),
      setFollowersOnly: (followersOnly) => set({ followersOnly }),
      setSearchQuery: (searchQuery) => set({ searchQuery }),

      clearAll: () => set(DEFAULT_STATE),

      activeCount: () => {
        const s = get();
        let count = 0;
        if (s.type) count++;
        if (s.worlds.length > 0) count++;
        if (s.subcategories.length > 0) count++;
        if (s.categories.length > 0) count++;
        if (s.itemConditions.length > 0) count++;
        if (s.locationFilter) count++;
        if (s.statusFilter !== 'open') count++;
        if (s.sortOrder !== 'newest') count++;
        if (s.proximitySortCity) count++;
        if (s.followersOnly) count++;
        if (s.searchQuery.trim().length >= 2) count++;
        return count;
      },
    }),
    {
      name: 'kc-filters',
      storage: createJSONStorage(() => AsyncStorage),
      version: 5,
      migrate: (persistedState: unknown) => {
        if (!persistedState || typeof persistedState !== 'object') {
          return { ...DEFAULT_STATE };
        }
        const state = persistedState as Record<string, unknown>;
        return {
          ...DEFAULT_STATE,
          type: (state.type as PostType) ?? null,
          worlds: Array.isArray(state.worlds) ? (state.worlds as string[]) : [],
          subcategories: Array.isArray(state.subcategories) ? (state.subcategories as string[]) : [],
          categories: [],
          itemConditions: Array.isArray(state.itemConditions) ? (state.itemConditions as ItemCondition[]) : [],
          locationFilter: (state.locationFilter as LocationFilter) ?? null,
          statusFilter: (state.statusFilter as FeedStatusFilter) ?? 'open',
          sortOrder: (state.sortOrder as FeedSortOrder) ?? 'newest',
          proximitySortCity: typeof state.proximitySortCity === 'string' ? state.proximitySortCity : null,
          proximitySortCityName: typeof state.proximitySortCityName === 'string' ? state.proximitySortCityName : null,
          followersOnly: Boolean(state.followersOnly),
          searchQuery: typeof state.searchQuery === 'string' ? state.searchQuery : '',
        };
      },
      partialize: (state) => ({
        type: state.type,
        worlds: state.worlds,
        subcategories: state.subcategories,
        categories: state.categories,
        itemConditions: state.itemConditions,
        locationFilter: state.locationFilter,
        statusFilter: state.statusFilter,
        sortOrder: state.sortOrder,
        proximitySortCity: state.proximitySortCity,
        proximitySortCityName: state.proximitySortCityName,
        followersOnly: state.followersOnly,
        searchQuery: state.searchQuery,
      }),
    }
  )
);
