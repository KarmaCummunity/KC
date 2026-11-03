// Saved routes (docs/spec/05_giving_worlds.md §5.3 step 4, D74; gap G48). The server resolves the
// places, caps routes at 10 and sends the alerts; these guard inputs and delegate.
import { RideError, isSameRidePlace, type RideSavedRoute, type SaveRideRouteInput } from '@kc/domain';
import type { IRideSavedRoutesRepository } from '../ports/IRideSavedRoutesRepository';

export class ListMyRideRoutesUseCase {
  constructor(private readonly repo: IRideSavedRoutesRepository) {}
  execute(): Promise<RideSavedRoute[]> {
    return this.repo.listMine();
  }
}

export class SaveRideRouteUseCase {
  constructor(private readonly repo: IRideSavedRoutesRepository) {}
  /** A route must go somewhere: origin and destination may not be the same place. */
  execute(input: SaveRideRouteInput): Promise<void> {
    if (isSameRidePlace(input.origin, input.dest)) {
      return Promise.reject(new RideError('same_route', 'same_route'));
    }
    return this.repo.save(input);
  }
}

export class RemoveRideRouteUseCase {
  constructor(private readonly repo: IRideSavedRoutesRepository) {}
  execute(routeId: string): Promise<void> {
    return this.repo.remove(routeId);
  }
}
