// Port contract tests (G39): framework-agnostic cases + assertions, one module per port.
export type { ContractCase } from './types';
export {
  ContractViolation,
  assertDefined,
  assertEqual,
  assertRejects,
  assertRejectsWithCode,
  assertSameList,
  assertTrue,
} from './assert';
export {
  newPostInput,
  postRepositoryContract,
  type PostRepositoryActor,
  type PostRepositoryContractContext,
} from './postRepository.contract';
export {
  savedPostsRepositoryContract,
  type SavedPostsActor,
  type SavedPostsContractContext,
} from './savedPostsRepository.contract';
export {
  CHAT_MESSAGE_MAX_LENGTH,
  chatRepositoryContract,
  type ChatActor,
  type ChatContractContext,
} from './chatRepository.contract';
export {
  reportRepositoryContract,
  type ReportActor,
  type ReportContractContext,
} from './reportRepository.contract';
export {
  FOLLOW_REQUEST_COOLDOWN_DAYS,
  followGraphContract,
  type FollowActor,
  type FollowGraph,
  type FollowGraphContractContext,
} from './followGraph.contract';
