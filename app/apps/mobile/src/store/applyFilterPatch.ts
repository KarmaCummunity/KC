import type { PostFilterValue } from '../components/PostFilterSheet';
import { useFilterStore } from './filterStore';

/**
 * Applies a filter-sheet patch to the persisted Home Feed filter. Reads actions via `getState()`
 * so a caller's callback stays stable and the search debounce does not loop (React #185).
 */
export function applyFilterPatch(patch: Partial<PostFilterValue>): void {
  const s = useFilterStore.getState();
  if ('type' in patch) s.setType(patch.type ?? null);
  if ('worlds' in patch) s.setWorlds(patch.worlds ?? []);
  if ('subcategories' in patch) s.setSubcategories(patch.subcategories ?? []);
  if ('categories' in patch) s.setCategories(patch.categories ?? []);
  if ('itemConditions' in patch) s.setItemConditions(patch.itemConditions ?? []);
  if ('locationFilter' in patch) s.setLocationFilter(patch.locationFilter ?? null);
  if ('statusFilter' in patch) s.setStatusFilter(patch.statusFilter ?? 'open');
  if ('sortOrder' in patch) s.setSortOrder(patch.sortOrder ?? 'newest');
  if ('proximitySortCity' in patch || 'proximitySortCityName' in patch) {
    s.setProximitySortCity(patch.proximitySortCity ?? null, patch.proximitySortCityName ?? null);
  }
  if ('followersOnly' in patch) s.setFollowersOnly(patch.followersOnly ?? false);
  if ('searchQuery' in patch) s.setSearchQuery(patch.searchQuery ?? '');
}
