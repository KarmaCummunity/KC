export interface VolunteerOpportunityBrowseRow {
  readonly opportunityId: string;
  readonly title: string;
  readonly summary: string | null;
  readonly locationLabel: string | null;
  readonly cityId: string | null;
  readonly nextShiftAt: string | null;
  readonly openSlots: number;
}

export interface VolunteerShiftSlot {
  readonly shiftId: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly capacity: number;
  readonly filled: number;
  readonly slotsOpen: number;
  readonly myStatus: string | null;
}

export interface VolunteerOpportunityDetail {
  readonly opportunityId: string;
  readonly organizerId: string;
  readonly title: string;
  readonly summary: string | null;
  readonly locationLabel: string | null;
  readonly cityId: string | null;
  readonly status: string;
  readonly shifts: readonly VolunteerShiftSlot[];
}

export interface MyVolunteerSignupRow {
  readonly signupId: string;
  readonly shiftId: string;
  readonly opportunityId: string;
  readonly title: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly status: string;
  readonly hoursLogged: number | null;
}

export interface MyVolunteerOpportunityOrganizerRow {
  readonly opportunityId: string;
  readonly title: string;
  readonly summary: string | null;
  readonly locationLabel: string | null;
  readonly cityId: string | null;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ShiftVolunteerRow {
  readonly signupId: string;
  readonly userId: string;
  readonly displayName: string | null;
  readonly shareHandle: string | null;
  readonly status: string;
  readonly waitlistPosition: number | null;
  readonly hoursLogged: number | null;
}
