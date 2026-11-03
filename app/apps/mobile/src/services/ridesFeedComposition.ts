// Composition root for the rides feed (docs/spec/05_giving_worlds.md §5.3 "Feed", D75; G49).
import { ListRidesFeedUseCase, type IRidesFeedRepository } from '@kc/application';
import { SupabaseRidesFeedRepository } from '@kc/infrastructure-supabase';
import type { RideFeedSection } from '@kc/domain';
import { getMarketplaceSupabaseClient } from './marketplaceComposition';

let repo: IRidesFeedRepository | null = null;

function repository(): IRidesFeedRepository {
  repo ??= new SupabaseRidesFeedRepository(getMarketplaceSupabaseClient());
  return repo;
}

/** The feed grouped today / tomorrow / later, in the device's local time. */
export function loadRidesFeed(): Promise<RideFeedSection[]> {
  return new ListRidesFeedUseCase(repository()).execute(new Date());
}

export const RIDES_FEED_QUERY_KEY = ['rides-feed'] as const;
