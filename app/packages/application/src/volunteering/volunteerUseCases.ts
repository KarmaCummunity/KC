import type { IVolunteerRepository } from '../ports/IVolunteerRepository';
import type {
  MyVolunteerOpportunityOrganizerRow,
  MyVolunteerSignupRow,
  ShiftVolunteerRow,
  VolunteerOpportunityBrowseRow,
  VolunteerOpportunityDetail,
} from '@kc/domain';

export class ListVolunteerOpportunitiesUseCase {
  constructor(private readonly repo: IVolunteerRepository) {}
  execute(limit?: number): Promise<VolunteerOpportunityBrowseRow[]> {
    return this.repo.listOpportunities(limit);
  }
}

export class GetVolunteerOpportunityDetailUseCase {
  constructor(private readonly repo: IVolunteerRepository) {}
  execute(opportunityId: string): Promise<VolunteerOpportunityDetail | null> {
    return this.repo.getOpportunityDetail(opportunityId);
  }
}

export class SignUpVolunteerShiftUseCase {
  constructor(private readonly repo: IVolunteerRepository) {}
  execute(shiftId: string) {
    return this.repo.signUpForShift(shiftId);
  }
}

export class CancelVolunteerSignupUseCase {
  constructor(private readonly repo: IVolunteerRepository) {}
  async execute(signupId: string): Promise<void> {
    await this.repo.cancelSignup(signupId);
  }
}

export class ListMyVolunteerSignupsUseCase {
  constructor(private readonly repo: IVolunteerRepository) {}
  execute(limit?: number): Promise<MyVolunteerSignupRow[]> {
    return this.repo.listMySignups(limit);
  }
}

export class CloseVolunteerOpportunityUseCase {
  constructor(private readonly repo: IVolunteerRepository) {}
  async execute(opportunityId: string): Promise<void> {
    await this.repo.closeOpportunity(opportunityId);
  }
}

export class ListMyOrganizerVolunteerOpportunitiesUseCase {
  constructor(private readonly repo: IVolunteerRepository) {}
  execute(limit?: number): Promise<MyVolunteerOpportunityOrganizerRow[]> {
    return this.repo.listMyOrganizerOpportunities(limit);
  }
}

export class ListShiftVolunteersUseCase {
  constructor(private readonly repo: IVolunteerRepository) {}
  execute(shiftId: string): Promise<ShiftVolunteerRow[]> {
    return this.repo.listShiftVolunteers(shiftId);
  }
}

export class OrganizerMessageShiftVolunteersUseCase {
  constructor(private readonly repo: IVolunteerRepository) {}
  execute(shiftId: string, message: string): Promise<number> {
    return this.repo.messageShiftVolunteers(shiftId, message);
  }
}
