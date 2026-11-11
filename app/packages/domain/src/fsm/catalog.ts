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
import { rideSeriesMachine } from './machines/rideSeries';
import { standingOrderMachine } from './machines/standingOrder';
import { timesheetMachine } from './machines/timesheet';
import { webhookEventMachine } from './machines/webhookEvent';

/**
 * The only registry of kernel machines. Every machine listed here has exactly the same rows
 * in the Postgres catalog (`kc_private.fsm_state` / `fsm_edge`, seeded by `supabase/schemas`);
 * the infrastructure contract test (`catalogMatchesSql.test.ts`) reads the schema sources and
 * fails when the two differ.
 *
 * To register a machine: add its module under `machines/`, list it here, and ship the matching
 * catalog insert next to its table in `supabase/schemas` (design spec §4.1).
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
];

/**
 * Machines the baseline does not seed: the parked back-office tools (admin tasks and
 * timesheets, `parkedFeatures.ts`) still derive their screen actions from them. They are not
 * in the catalog, so the contract test does not compare them; they leave with those tools or
 * move into the catalog when the baseline gains the owning module.
 */
export const LEGACY_FSM_MACHINES: readonly FsmMachine<string, string>[] = [
  adminTaskMachine,
  timesheetMachine,
];
