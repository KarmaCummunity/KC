// Mapped to spec: docs/spec/08_organizations.md Events (G1 step 5, D31) — the registration part
// of an organization event's post page: the organizer manages the roster, any other signed-in
// member registers and follows their own registration. A guest sees the details only, and an
// event without a post yet (pending publication) takes no registrations.
import React from 'react';
import { ORG_EVENT_KIND_SLUG, parseEventPostDetails, type MarketplaceListingDetail } from '@kc/domain';
import { useAuthStore } from '../../../store/authStore';
import { EventRegistrantPanel } from './EventRegistrantPanel';
import { EventRosterPanel } from './EventRosterPanel';

interface Props {
  readonly detail: MarketplaceListingDetail;
}

export function EventRegistrationActions({ detail }: Props) {
  const userId = useAuthStore((s) => s.session?.userId ?? null);
  const event = detail.kindSlug === ORG_EVENT_KIND_SLUG ? parseEventPostDetails(detail.details) : null;
  if (!event || !userId || !detail.feedPostId) return null;

  return userId === detail.ownerId ? (
    <EventRosterPanel postId={detail.feedPostId} startsAt={event.startsAt} />
  ) : (
    <EventRegistrantPanel postId={detail.feedPostId} event={event} />
  );
}
