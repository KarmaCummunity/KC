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
