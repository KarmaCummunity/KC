// Housing code of conduct and private place use cases (docs/spec/requirements/21_housing.md
// FR-HOUSING-003 AC3, FR-HOUSING-012). Server: migrations 0600 (conduct), 0601 (place).
import type { HousingPrivateDetails } from '@kc/domain';
import type { HousingPrivateDetailsInput, IHousingRepository } from '../ports/IHousingRepository';

/** Where the member stands with the code of conduct: the current version and whether it is accepted. */
export interface HousingConductStatus {
  readonly version: number;
  readonly accepted: boolean;
}

export class GetHousingConductStatusUseCase {
  constructor(private readonly repo: IHousingRepository) {}
  async execute(): Promise<HousingConductStatus> {
    const [version, accepted] = await Promise.all([this.repo.currentConductVersion(), this.repo.hasAcceptedConduct()]);
    return { version, accepted };
  }
}

export class AcceptHousingConductUseCase {
  constructor(private readonly repo: IHousingRepository) {}
  /** Accepts the version the member was shown; the server refuses a stale one. */
  execute(version: number): Promise<void> {
    return this.repo.acceptConduct(version);
  }
}

export class GetHousingPrivateDetailsUseCase {
  constructor(private readonly repo: IHousingRepository) {}
  /** Null when the place is not open to the member (not the host, or outside the reveal window). */
  execute(listingId: string): Promise<HousingPrivateDetails | null> {
    return this.repo.getPrivateDetails(listingId);
  }
}

export class SetHousingPrivateDetailsUseCase {
  constructor(private readonly repo: IHousingRepository) {}
  execute(input: HousingPrivateDetailsInput): Promise<void> {
    return this.repo.setPrivateDetails({
      ...input,
      houseNumber: input.houseNumber.trim(),
      entranceNotes: input.entranceNotes?.trim() || null,
      accessInstructions: input.accessInstructions?.trim() || null,
    });
  }
}
