import { describe, expect, expectTypeOf, it } from 'vitest';
import { FINANCE_ENTRY_STATUSES } from '../../admin/FinanceLedger';
import { HOUSING_BOOKING_STATUSES } from '../../housing/HousingStay';
import { KNOWLEDGE_BOOKING_STATUSES } from '../../knowledge/knowledgeSlots';
import { EVENT_REGISTRATION_STATUSES } from '../../marketplace/eventPost';
import { RIDE_BOOKING_CANCELLED_STATUS, RIDE_BOOKING_STATUSES } from '../../rides/RideBooking';
import { RIDE_SERIES_STATUSES } from '../../rides/RideSeries';
import { POST_STATUSES } from '../../posts';
import type {
  AccountStatus, FollowRequestStatus, OnboardingState, PostStatus,
} from '../../value-objects';
import {
  accountStatusMachine, eventRegistrationMachine, followRequestMachine, givingHandoffMachine,
  housingBookingMachine, onboardingMachine, orgFinanceEntryMachine, postMachine,
  rideBookingMachine, rideSeriesMachine,
} from '..';

/**
 * Status lists the app keeps outside the kernel must name exactly the states of the baseline
 * machine that rules them (`kc_private.fsm_state`; `catalogMatchesSql.test.ts` ties the
 * machines to the schema sources). A vocabulary that drifts fails here, not in production.
 */
const sorted = (values: readonly string[]): string[] => [...values].sort();

describe('status vocabularies mirror the baseline machines', () => {
  it('post, account, onboarding and follow-request unions equal their machine states', () => {
    expectTypeOf<(typeof postMachine.states)[number]>().toEqualTypeOf<PostStatus>();
    expectTypeOf<(typeof accountStatusMachine.states)[number]>().toEqualTypeOf<AccountStatus>();
    expectTypeOf<(typeof onboardingMachine.states)[number]>().toEqualTypeOf<OnboardingState>();
    expectTypeOf<(typeof followRequestMachine.states)[number]>().toEqualTypeOf<FollowRequestStatus>();
    expect(sorted(POST_STATUSES)).toEqual(sorted(postMachine.states));
  });

  it('a post can be a draft before it is published', () => {
    expect(postMachine.states).toContain('draft');
  });

  it('handoff status lists equal the states of their machines', () => {
    expect(sorted(HOUSING_BOOKING_STATUSES)).toEqual(sorted(housingBookingMachine.states));
    expect(sorted(KNOWLEDGE_BOOKING_STATUSES)).toEqual(sorted(givingHandoffMachine.states));
    expect(sorted(EVENT_REGISTRATION_STATUSES)).toEqual(sorted(eventRegistrationMachine.states));
    expect(sorted([...RIDE_BOOKING_STATUSES, RIDE_BOOKING_CANCELLED_STATUS])).toEqual(
      sorted(rideBookingMachine.states),
    );
  });

  it('money and series lists use the double-l spelling of the baseline', () => {
    expect(sorted(FINANCE_ENTRY_STATUSES)).toEqual(sorted(orgFinanceEntryMachine.states));
    expect(sorted(RIDE_SERIES_STATUSES)).toEqual(sorted(rideSeriesMachine.states));
  });
});
