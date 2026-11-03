// ─────────────────────────────────────────────
// Composition root for IUserRepository (follow use cases) — mirrors postsComposition.ts.
// Mapped to SRS: FR-FOLLOW-001..009, 011; FR-PROFILE-005, 006.
// ─────────────────────────────────────────────

import {
  getSupabaseClient,
  SupabaseUserRepository,
} from '@kc/infrastructure-supabase';
import {
  FollowUserUseCase,
  UnfollowUserUseCase,
  SendFollowRequestUseCase,
  CancelFollowRequestUseCase,
  AcceptFollowRequestUseCase,
  RejectFollowRequestUseCase,
  RemoveFollowerUseCase,
  ListFollowersUseCase,
  ListFollowingUseCase,
  ListPendingFollowRequestsUseCase,
  GetFollowStateUseCase,
  UpdatePrivacyModeUseCase,
} from '@kc/application';
import { pickAuthStorage } from './authSecureStorage';

let repo: SupabaseUserRepository | null = null;
function getRepo() {
  repo ??= new SupabaseUserRepository(getSupabaseClient({ storage: pickAuthStorage() }));
  return repo;
}

export const getFollowUserUseCase = () => new FollowUserUseCase(getRepo());
export const getUnfollowUserUseCase = () => new UnfollowUserUseCase(getRepo());
export const getSendFollowRequestUseCase = () => new SendFollowRequestUseCase(getRepo());
export const getCancelFollowRequestUseCase = () => new CancelFollowRequestUseCase(getRepo());
export const getAcceptFollowRequestUseCase = () => new AcceptFollowRequestUseCase(getRepo());
export const getRejectFollowRequestUseCase = () => new RejectFollowRequestUseCase(getRepo());
export const getRemoveFollowerUseCase = () => new RemoveFollowerUseCase(getRepo());
export const getListFollowersUseCase = () => new ListFollowersUseCase(getRepo());
export const getListFollowingUseCase = () => new ListFollowingUseCase(getRepo());
export const getListPendingFollowRequestsUseCase = () => new ListPendingFollowRequestsUseCase(getRepo());
export const getGetFollowStateUseCase = () => new GetFollowStateUseCase(getRepo());
export const getUpdatePrivacyModeUseCase = () => new UpdatePrivacyModeUseCase(getRepo());
export const getFollowUserRepo = getRepo;
