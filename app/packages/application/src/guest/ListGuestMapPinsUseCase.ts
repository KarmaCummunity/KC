import type { GuestMapBounds, GuestMapPin, IGuestMapRepository } from '../ports/IGuestMapRepository';

export class ListGuestMapPinsUseCase {
  constructor(private readonly repo: IGuestMapRepository) {}

  execute(input: {
    readonly bounds: GuestMapBounds;
    readonly filters?: Readonly<Record<string, unknown>>;
    readonly limit?: number;
  }): Promise<readonly GuestMapPin[]> {
    return this.repo.listPins(input.bounds, input.filters, input.limit);
  }
}
