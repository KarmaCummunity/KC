import type {
  MyVolunteerOpportunityOrganizerRow,
  MyVolunteerSignupRow,
  ShiftVolunteerRow,
  VolunteerOpportunityBrowseRow,
  VolunteerOpportunityDetail,
} from '@kc/domain';

export interface IVolunteerRepository {
  listOpportunities(limit?: number): Promise<VolunteerOpportunityBrowseRow[]>;
  getOpportunityDetail(opportunityId: string): Promise<VolunteerOpportunityDetail | null>;
  signUpForShift(shiftId: string): Promise<{ signupId: string; status: string }>;
  cancelSignup(signupId: string): Promise<void>;
  listMySignups(limit?: number): Promise<MyVolunteerSignupRow[]>;
  closeOpportunity(opportunityId: string): Promise<void>;
  listMyOrganizerOpportunities(limit?: number): Promise<MyVolunteerOpportunityOrganizerRow[]>;
  listShiftVolunteers(shiftId: string): Promise<ShiftVolunteerRow[]>;
  messageShiftVolunteers(shiftId: string, message: string): Promise<number>;
}
