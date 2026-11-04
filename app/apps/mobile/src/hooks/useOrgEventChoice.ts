// Mapped to spec: docs/spec/08_organizations.md Events (G1 step 5, D31) — the create form's
// choice between the time world's default offer (a volunteer shift) and an organization's event.
// Only a member of an organization gets the choice; the organizations load once per session.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ListingKindOption, OrganizationMembershipOption } from '@kc/domain';
import type { CreateDirection } from '../lib/unifiedCreate/createCategories';
import { canChooseOrgEvent, preselectedOrgId } from '../lib/unifiedCreate/orgEventCreate';
import {
  eventRegistrationUseCases,
  MY_ORGANIZATIONS_QUERY_KEY,
} from '../services/eventRegistrationComposition';
import { useAuthStore } from '../store/authStore';

/** The only world whose offers can be an organization's event. */
const EVENT_WORLD_SLUG = 'time';
const NO_ORGANIZATIONS: readonly OrganizationMembershipOption[] = [];

export interface OrgEventChoice {
  /** The member may publish an organization's event here (shows the kind chooser). */
  readonly available: boolean;
  readonly organizations: readonly OrganizationMembershipOption[];
  /** The form publishes an organization's event. */
  readonly isOrgEvent: boolean;
  readonly setWantsOrgEvent: (wants: boolean) => void;
  /** The organization the event is published for; preselected when the member has exactly one. */
  readonly orgId: string | null;
  readonly setOrgId: (orgId: string) => void;
}

export function useOrgEventChoice(
  worldSlug: string,
  direction: CreateDirection,
  kinds: readonly ListingKindOption[],
): OrgEventChoice {
  const userId = useAuthStore((s) => s.session?.userId ?? null);
  const organizationsQuery = useQuery({
    queryKey: MY_ORGANIZATIONS_QUERY_KEY,
    queryFn: () => eventRegistrationUseCases.listMyOrganizations().execute(),
    enabled: worldSlug === EVENT_WORLD_SLUG && userId !== null,
    staleTime: 5 * 60_000, // memberships change rarely
  });
  const [wantsOrgEvent, setWantsOrgEvent] = useState(false);
  const [pickedOrgId, setOrgId] = useState<string | null>(null);

  // A failed load leaves no organizations, so the member sees today's form.
  const organizations = organizationsQuery.data ?? NO_ORGANIZATIONS;
  const available = worldSlug === EVENT_WORLD_SLUG && canChooseOrgEvent(kinds, direction, organizations);
  return {
    available,
    organizations,
    isOrgEvent: available && wantsOrgEvent,
    setWantsOrgEvent,
    orgId: pickedOrgId ?? preselectedOrgId(organizations),
    setOrgId,
  };
}
