// Mapped to spec: docs/spec/05_giving_worlds.md §5.11 (#1476) — a job offer is published in the
// name of an organization allowed to post jobs (the platform organization, or one a platform
// admin switched on). Pure rules of the create form; the server re-judges on publish
// (`job_offer_org_required`). Looking for work needs no organization.
import type { OrganizationMembershipOption } from '@kc/domain';

export const EMPLOYMENT_WORLD_SLUG = 'employment';
export const JOB_OFFER_KIND_SLUG = 'job_offer';

/** What the form knows about the job offer's organization. */
export interface JobOfferOrgState {
  /** The form publishes a job offer, so it needs an organization. */
  readonly required: boolean;
  /** The member's organizations finished loading (a slow load is not "none allowed"). */
  readonly loaded: boolean;
  /** The member's organizations that may post jobs. */
  readonly organizations: readonly OrganizationMembershipOption[];
  /** The organization the job offer is published for. */
  readonly orgId: string | null;
}

/** i18n key of the form's problem with the job offer's organization. */
export type JobOfferOrgProblemKey = 'jobOffer.create.noEligibleOrg' | 'jobOffer.create.orgRequired';

/** True when the form is a job offer of the employment world. */
export function isJobOffer(worldSlug: string, kindSlug: string | null | undefined): boolean {
  return worldSlug === EMPLOYMENT_WORLD_SLUG && kindSlug === JOB_OFFER_KIND_SLUG;
}

/** The member's organizations that may publish a job offer, in their given order. */
export function jobOfferOrganizations(
  organizations: readonly OrganizationMembershipOption[],
): OrganizationMembershipOption[] {
  return organizations.filter((org) => org.mayPostJobs);
}

/** The organization picked for the member when they have exactly one that may post jobs. */
export function preselectedJobOfferOrgId(organizations: readonly OrganizationMembershipOption[]): string | null {
  return organizations.length === 1 ? organizations[0]!.orgId : null;
}

/** The first problem of the job offer's organization, or null when the form may publish. */
export function jobOfferOrgProblem(state: JobOfferOrgState): JobOfferOrgProblemKey | null {
  if (!state.required) return null;
  if (state.orgId && state.organizations.some((org) => org.orgId === state.orgId)) return null;
  // Only once loaded: until then the member may still turn out to have an allowed organization.
  if (state.loaded && state.organizations.length === 0) return 'jobOffer.create.noEligibleOrg';
  return 'jobOffer.create.orgRequired';
}

/** The details a job offer submits: the organization it is published for (`details.org_id`). */
export function withJobOfferOrg(details: Record<string, unknown>, state: JobOfferOrgState): Record<string, unknown> {
  return state.required && state.orgId ? { ...details, org_id: state.orgId } : details;
}
