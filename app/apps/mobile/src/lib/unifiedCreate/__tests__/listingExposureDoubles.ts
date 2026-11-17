// Test doubles for the two composition roots the listing form's exposure settings read:
// the post repository (identity mask) and the user repository (profile privacy).
import { vi } from 'vitest';

export const exposureSpies = {
  listIdentities: vi.fn(async () => [] as unknown[]),
  upsertIdentity: vi.fn(async () => undefined),
};

export const postsCompositionDouble = {
  getPostRepo: () => ({
    listPostActorIdentities: exposureSpies.listIdentities,
    upsertPostActorIdentity: exposureSpies.upsertIdentity,
  }),
  // The edit path saves the mask through the same use cases as the items form.
  getListPostActorIdentityUseCase: () => ({ execute: () => exposureSpies.listIdentities() }),
  getUpsertPostActorIdentityUseCase: () => ({ execute: exposureSpies.upsertIdentity }),
};

export const userCompositionDouble = {
  getUserRepo: () => ({ findById: async () => ({ privacyMode: 'Private', followersCount: 0 }) }),
};
