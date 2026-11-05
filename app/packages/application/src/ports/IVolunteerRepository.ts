import type {
  MyVolunteerOpportunityOrganizerRow,
  MyVolunteerSignupRow,
  ShiftVolunteerRow,
  VolunteerCheckInResult,
  VolunteerOpportunityBrowseRow,
  VolunteerOpportunityDetail,
} from '@kc/domain';

export interface IVolunteerRepository {
  listOpportunities(limit?: number, offset?: number): Promise<VolunteerOpportunityBrowseRow[]>;
  getOpportunityDetail(opportunityId: string): Promise<VolunteerOpportunityDetail | null>;
  signUpForShift(shiftId: string): Promise<{ signupId: string; status: string }>;
  cancelSignup(signupId: string): Promise<void>;
  listMySignups(limit?: number): Promise<MyVolunteerSignupRow[]>;
  checkIn(signupId: string): Promise<VolunteerCheckInResult>;
  getShiftIcs(shiftId: string): Promise<string | null>;
  closeOpportunity(opportunityId: string): Promise<void>;
  listMyOrganizerOpportunities(limit?: number): Promise<MyVolunteerOpportunityOrganizerRow[]>;
  listShiftVolunteers(shiftId: string): Promise<ShiftVolunteerRow[]>;
  messageShiftVolunteers(shiftId: string, message: string): Promise<number>;
}
