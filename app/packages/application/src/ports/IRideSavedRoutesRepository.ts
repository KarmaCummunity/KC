import type { RideSavedRoute, SaveRideRouteInput } from '@kc/domain';

/** The caller's saved routes (docs/spec/05_giving_worlds.md §5.3 step 4, D74). */
export interface IRideSavedRoutesRepository {
  listMine(): Promise<RideSavedRoute[]>;
  save(input: SaveRideRouteInput): Promise<void>;
  remove(routeId: string): Promise<void>;
}
