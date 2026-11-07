// Stay section of a housing offer screen (docs/spec/requirements/21_housing.md FR-HOUSING-015, 016,
// 036, 037): the host manages every booking, a signed-in guest requests and follows their own.
// Stay requests have no bookings; a guest sees nothing until signing in.
import React from 'react';
import { housingOfferTerms, type MarketplaceListingDetail } from '@kc/domain';
import { useAuthStore } from '../../../store/authStore';
import { HousingGuestPanel } from './HousingGuestPanel';
import { HousingHostPanel } from './HousingHostPanel';

interface Props {
  readonly detail: MarketplaceListingDetail;
  readonly hideOwnerAssign?: boolean;
}

export function HousingStayActions({ detail, hideOwnerAssign = false }: Props) {
  const userId = useAuthStore((s) => s.session?.userId ?? null);
  if (detail.worldSlug !== 'housing' || detail.direction !== 'give' || !userId) return null;
  return userId === detail.ownerId ? (
    <HousingHostPanel listingId={detail.listingId} cityId={detail.cityId} hideOwnerAssign={hideOwnerAssign} />
  ) : (
    <HousingGuestPanel listingId={detail.listingId} terms={housingOfferTerms(detail.details)} />
  );
}
