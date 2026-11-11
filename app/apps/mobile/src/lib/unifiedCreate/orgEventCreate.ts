// Mapped to spec: docs/spec/08_organizations.md Events (G1 step 5, D31) — which kind the time
// world's offer form publishes. A member of an organization chooses between the default kind (a
// volunteer shift) and an organization's event; everyone else sees exactly the default form.
import { ORG_EVENT_KIND_SLUG, type ListingKindOption, type OrganizationMembershipOption } from '@kc/domain';
import type { CreateDirection } from './createCategories';
import { kindChoices, kindForDirection } from './listingFieldSpecs';

/** The world's organization-event kind, when the server offers one. */
export function orgEventKind(kinds: readonly ListingKindOption[]): ListingKindOption | null {
  return kinds.find((k) => k.slug === ORG_EVENT_KIND_SLUG) ?? null;
}

/**
 * Whether the form offers a member's own event (FR-POST-024): an offer in a world with the event
 * kind. A volunteering slot with sign-up is an event, and any member may publish one.
 */
export function canChoosePersonalEvent(kinds: readonly ListingKindOption[], direction: CreateDirection): boolean {
  return direction === 'give' && orgEventKind(kinds) !== null;
}

/** Whether the form offers the event choice: an offer, by a member of an organization, in a world with the kind. */
export function canChooseOrgEvent(
  kinds: readonly ListingKindOption[],
  direction: CreateDirection,
  organizations: readonly OrganizationMembershipOption[],
): boolean {
  return direction === 'give' && organizations.length > 0 && orgEventKind(kinds) !== null;
}

/**
 * Whether the form tells a member how to publish an organization's event: an offer in a world with
 * the kind, by someone who belongs to no organization yet (FR-ORG-002, G18).
 */
export function suggestsOrgMembership(
  kinds: readonly ListingKindOption[],
  direction: CreateDirection,
  organizations: readonly OrganizationMembershipOption[],
): boolean {
  return direction === 'give' && organizations.length === 0 && orgEventKind(kinds) !== null;
}

/**
 * The kind the form publishes: the event when the member chose one (their own or an
 * organization's), else the kind the member picked for this direction (`chosenSlug`), otherwise
 * the direction's default.
 */
export function kindForCreate(
  kinds: readonly ListingKindOption[],
  direction: CreateDirection,
  wantsEvent: boolean,
  chosenSlug: string | null = null,
): ListingKindOption | null {
  if (wantsEvent) return orgEventKind(kinds);
  const chosen = chosenSlug ? kindChoices(kinds, direction).find((k) => k.slug === chosenSlug) : undefined;
  return chosen ?? kindForDirection(kinds, direction);
}

/** The organization picked before the member chooses: the only one, when there is exactly one. */
export function preselectedOrgId(organizations: readonly OrganizationMembershipOption[]): string | null {
  return organizations.length === 1 ? (organizations[0]?.orgId ?? null) : null;
}
