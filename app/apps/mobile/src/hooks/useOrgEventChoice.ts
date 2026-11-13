// Mapped to spec: docs/spec/08_organizations.md Events (G1 step 5, D31) — the create form's
// choice between the time world's default offer (a volunteer shift) and an organization's event.
// Only a member of an organization gets the choice; the organizations load once per session.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ListingKindOption, OrganizationMembershipOption } from '@kc/domain';
import type { CreateDirection } from '../lib/unifiedCreate/createCategories';
import { canChooseOrgEvent, canChoosePersonalEvent, preselectedOrgId, suggestsOrgMembership } from '../lib/unifiedCreate/orgEventCreate';
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
  /** The member belongs to no organization yet: the form says how to publish an event. */
  readonly suggestMembership: boolean;
  readonly organizations: readonly OrganizationMembershipOption[];
  /** The form publishes an organization's event. */
  readonly isOrgEvent: boolean;
  readonly setWantsOrgEvent: (wants: boolean) => void;
  /** Any member may publish their own event here: volunteering with sign-up (FR-POST-024). */
  readonly personalAvailable: boolean;
  /** The form publishes the member's own event, for no organization. */
  readonly isPersonalEvent: boolean;
  readonly setWantsPersonalEvent: (wants: boolean) => void;
  /** The form publishes an event, the member's own or an organization's. */
  readonly isEvent: boolean;
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
  // What the member chose: the default offer, their own event, or an organization's event.
  const [mode, setMode] = useState<'none' | 'personal' | 'org'>('none');
  const [pickedOrgId, setOrgId] = useState<string | null>(null);

  // A failed load leaves no organizations, so the member sees today's form.
  const organizations = organizationsQuery.data ?? NO_ORGANIZATIONS;
  const available = worldSlug === EVENT_WORLD_SLUG && canChooseOrgEvent(kinds, direction, organizations);
  // Only once the memberships loaded, so a slow load never flashes the hint at a member.
  const suggestMembership = worldSlug === EVENT_WORLD_SLUG
    && organizationsQuery.isSuccess
    && suggestsOrgMembership(kinds, direction, organizations);
  const personalAvailable = worldSlug === EVENT_WORLD_SLUG && canChoosePersonalEvent(kinds, direction);
  const isOrgEvent = available && mode === 'org';
  const isPersonalEvent = personalAvailable && mode === 'personal';
  return {
    available,
    suggestMembership,
    organizations,
    isOrgEvent,
    setWantsOrgEvent: (wants: boolean) => setMode(wants ? 'org' : 'none'),
    personalAvailable,
    isPersonalEvent,
    setWantsPersonalEvent: (wants: boolean) => setMode(wants ? 'personal' : 'none'),
    isEvent: isOrgEvent || isPersonalEvent,
    orgId: pickedOrgId ?? preselectedOrgId(organizations),
    setOrgId,
  };
}
