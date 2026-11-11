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
import { knowledgeTopicMachine } from './machines/knowledgeTopic';
import { kycMachine } from './machines/kyc';
import { matchMachine } from './machines/match';
import { moderationQueueMachine } from './machines/moderationQueue';
import { onboardingMachine } from './machines/onboarding';
import { organizationMachine } from './machines/organization';
import { orgApplicationMachine } from './machines/orgApplication';
import { orgFinanceEntryMachine } from './machines/orgFinanceEntry';
import { paymentMachine } from './machines/payment';
import { payoutMachine } from './machines/payout';
import { postMachine } from './machines/post';
import { postCommentMachine } from './machines/postComment';
import { postMediaMachine } from './machines/postMedia';
import { refundMachine } from './machines/refund';
import { reportMachine } from './machines/report';
import { reviewDecisionMachine } from './machines/reviewDecision';
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
 * Machines of the pre-baseline database that the baseline does not seed: the back-office and
 * knowledge tools (packages L2, L6, L7 of `docs/db/app-migration-map.md`) still import them.
 * They are not in the catalog, so the contract test does not compare them. The package that
 * migrates the owning module deletes its machine here and in `machines/`.
 */
export const LEGACY_FSM_MACHINES: readonly FsmMachine<string, string>[] = [
  adminTaskMachine,
  knowledgeTopicMachine,
  reviewDecisionMachine,
  timesheetMachine,
];
