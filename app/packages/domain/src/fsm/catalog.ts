import type { FsmMachine } from './machine';
import { accountStatusMachine } from './machines/accountStatus';
import { adminTaskMachine } from './machines/adminTask';
import { donationLinkReviewMachine } from './machines/donationLinkReview';
import { eventRegistrationMachine } from './machines/eventRegistration';
import { followRequestMachine } from './machines/followRequest';
import { givingHandoffMachine } from './machines/givingHandoff';
import { housingBookingMachine } from './machines/housingBooking';
import { knowledgeTopicMachine } from './machines/knowledgeTopic';
import { onboardingMachine } from './machines/onboarding';
import { postMachine } from './machines/post';
import { postCommentMachine } from './machines/postComment';
import { reportMachine } from './machines/report';
import { reviewDecisionMachine } from './machines/reviewDecision';
import { rideBookingMachine } from './machines/rideBooking';
import { timesheetMachine } from './machines/timesheet';

/**
 * The only registry of kernel machines. Every machine listed here must have the same
 * rows in the Postgres catalog (`fsm_state` / `fsm_edge`); the infrastructure contract
 * test replays `supabase/migrations` and fails when the two differ.
 *
 * To register a machine: add its module under `machines/`, list it here, and ship the
 * matching catalog insert in a migration (design spec §4.1).
 */
export const FSM_MACHINES: readonly FsmMachine<string, string>[] = [
  adminTaskMachine,
  postMachine,
  givingHandoffMachine,
  rideBookingMachine,
  housingBookingMachine,
  eventRegistrationMachine,
  accountStatusMachine,
  onboardingMachine,
  postCommentMachine,
  knowledgeTopicMachine,
  reportMachine,
  followRequestMachine,
  reviewDecisionMachine,
  donationLinkReviewMachine,
  timesheetMachine,
];
