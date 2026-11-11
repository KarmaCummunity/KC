// Composition root of the ride features that need no screen-specific root of their own: the
// driver declaration gate (FR-RIDE-041). Bookings, places, the feed, saved routes, series, house
// numbers and safety have their own roots in `src/services/ride*Composition.ts`.
import { SupabaseDriverDeclarationRepository } from '@kc/infrastructure-supabase';
import {
  AcceptDriverDeclarationUseCase,
  type IDriverDeclarationRepository,
} from '@kc/application';
import { getMarketplaceSupabaseClient } from '../../../services/marketplaceComposition';

let _declarations: IDriverDeclarationRepository | null = null;
let _acceptDeclaration: AcceptDriverDeclarationUseCase | null = null;

function getDeclarationRepo(): IDriverDeclarationRepository {
  _declarations ??= new SupabaseDriverDeclarationRepository(getMarketplaceSupabaseClient());
  return _declarations;
}

export function getAcceptDriverDeclarationUseCase(): AcceptDriverDeclarationUseCase {
  _acceptDeclaration ??= new AcceptDriverDeclarationUseCase(getDeclarationRepo());
  return _acceptDeclaration;
}
