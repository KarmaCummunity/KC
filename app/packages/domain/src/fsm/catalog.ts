import type { FsmMachine } from './machine';
import { accountStatusMachine } from './machines/accountStatus';
import { adminTaskMachine } from './machines/adminTask';
import { challengeMachine } from './machines/challenge';
import { donationIntentMachine } from './machines/donationIntent';
import { donationLinkReviewMachine } from './machines/donationLinkReview';
import { eventRegistrationMachine } from './machines/eventRegistration';
import { followRequestMachine } from './machines/followRequest';
import { givingHandoffMachine } from './machines/givingHandoff';
import { housingBookingMachine } from './machines/housingBooking';
import { kycMachine } from './machines/kyc';
import { matchMachine } from './machines/match';
import { moderationQueueMachine } from './machines/moderationQueue';
import { onboardingMachine } from './machines/onboarding';
import { organizationMachine } from './machines/organization';
import { orgSec46Machine } from './machines/orgSec46';
import { orgApplicationMachine } from './machines/orgApplication';
import { orgFinanceEntryMachine } from './machines/orgFinanceEntry';
import { paymentMachine } from './machines/payment';
import { payoutMachine } from './machines/payout';
import { postMachine } from './machines/post';
import { postCommentMachine } from './machines/postComment';
import { postMediaMachine } from './machines/postMedia';
import { refundMachine } from './machines/refund';
import { reportMachine } from './machines/report';
import { rideBookingMachine } from './machines/rideBooking';
import { postSeriesMachine } from './machines/postSeries';
import { rideSeriesMachine } from './machines/rideSeries';
import { standingOrderMachine } from './machines/standingOrder';
import { timesheetMachine } from './machines/timesheet';
import { webhookEventMachine } from './machines/webhookEvent';

/**
 * The only registry of kernel machines. Every machine listed here has exactly the same rows
 * in the Postgres catalog (`kc_private.fsm_state` / `fsm_edge`, seeded by `supabase/schemas` and
 * by the forward migrations after the baseline); the infrastructure contract test
 * (`catalogMatchesSql.test.ts`) reads both and fails when the two differ.
 *
 * To register a machine: add its module under `machines/`, list it here, and ship the matching
 * catalog insert in the forward migration that creates its table (design spec §4.1).
 */
export const FSM_MACHINES: readonly FsmMachine<string, string>[] = [
  accountStatusMachine,
  onboardingMachine,
  followRequestMachine,
  postMachine,
  givingHandoffMachine,
  rideBookingMachine,
  housingBookingMachine,
  eventRegistrationMachine,
  postMediaMachine,
  postCommentMachine,
  reportMachine,
  moderationQueueMachine,
  rideSeriesMachine,
  postSeriesMachine,
  challengeMachine,
  matchMachine,
  organizationMachine,
  orgSec46Machine,
  orgApplicationMachine,
  donationLinkReviewMachine,
  standingOrderMachine,
  donationIntentMachine,
  paymentMachine,
  refundMachine,
  payoutMachine,
  kycMachine,
  webhookEventMachine,
  orgFinanceEntryMachine,
  adminTaskMachine,
  timesheetMachine,
];

