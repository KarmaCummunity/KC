// Public surface of the FSM kernel. SQL replay tooling lives in infrastructure tests, not here.
export { TransitionError } from './TransitionError';
export type { TransitionErrorCode, TransitionErrorDetails } from './TransitionError';
export {
  assertTransition, canTransition, defineMachine, isTerminal,
} from './machine';
export type {
  FsmEdge, FsmMachine, TransitionAnswer, TransitionFail, TransitionOk,
} from './machine';
export { FSM_MACHINES } from './catalog';
export { adminTaskMachine } from './machines/adminTask';
export { postMachine } from './machines/post';
export { givingHandoffMachine } from './machines/givingHandoff';
export { rideBookingMachine } from './machines/rideBooking';
export { housingBookingMachine } from './machines/housingBooking';
export { eventRegistrationMachine } from './machines/eventRegistration';
export { onboardingMachine } from './machines/onboarding';
export { postCommentMachine } from './machines/postComment';
export { knowledgeTopicMachine } from './machines/knowledgeTopic';
export { reportMachine } from './machines/report';
export { followRequestMachine } from './machines/followRequest';
export { reviewDecisionMachine } from './machines/reviewDecision';
export { donationLinkReviewMachine } from './machines/donationLinkReview';
export { handoffMachineFor } from './machines/handoffMachineFor';
export { accountStatusMachine } from './machines/accountStatus';
