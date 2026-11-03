import type { RidePlace } from '@kc/domain';

/**
 * Official places a ride can start, end or stop at (docs/spec/05_giving_worlds.md §5.3, D71).
 * Streets are not listed: they are picked inside a chosen city.
 */
export interface IRidePlaceRepository {
  /** Every city with coordinates and every junction / interchange, sorted by label. */
  listPlaces(): Promise<RidePlace[]>;
}
