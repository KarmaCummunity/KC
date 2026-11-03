// The ride place picker's catalog: official cities and junctions only (D71; gap G45).
import type { RidePlace } from '@kc/domain';
import type { IRidePlaceRepository } from '../ports/IRidePlaceRepository';

export class ListRidePlacesUseCase {
  constructor(private readonly repo: IRidePlaceRepository) {}
  execute(): Promise<RidePlace[]> {
    return this.repo.listPlaces();
  }
}
