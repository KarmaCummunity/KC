// Mapped to spec: FR-POST-001 AC6 — the first problem of a listing form that blocks publishing,
// with the section it belongs to (so the form can outline and scroll to it). Pure: everything it
// reads comes in as input, in the order the sections appear in the form.
import type { TFunction } from 'i18next';
import {
  hasInvalidRideHouseNumber,
  validateListingDetails,
  type ListingKindOption,
  type RideHouseNumbers,
} from '@kc/domain';
import type { CreateDirection } from './createCategories';
import { firstMissingRequiredField, type ListingFieldSpec } from './listingFieldSpecs';
import { marketplaceRuleFieldError } from '../marketplaceCreateErrors';
import type { RideRecurrenceDraft } from '../../components/giving/RideRecurrenceFields';
import { isEventSeriesDuration } from './seriesPublish';
import { jobOfferOrgProblem, type JobOfferOrgState } from './jobOfferOrg';
import { detailField, fieldForHouseNumbers, fieldForRule, type ListingFormProblem } from './listingFormProblem';

/** The shortest title a listing may have. */
export const TITLE_MIN = 2;

export interface ListingProblemInput {
  readonly t: TFunction;
  /** The details as they would be sent. */
  readonly submitted: Record<string, unknown>;
  readonly worldSlug: string;
  readonly direction: CreateDirection;
  readonly kind: ListingKindOption | null;
  readonly specs: readonly ListingFieldSpec[];
  /** The details as typed (checked for missing required fields). */
  readonly details: Record<string, unknown>;
  readonly city: { id: string } | null;
  readonly effectiveTitle: string;
  readonly isRides: boolean;
  readonly eventChoice: { readonly isOrgEvent: boolean; readonly orgId: string | null };
  /** The organization of a job offer (§5.11, #1476). */
  readonly jobOfferOrg: JobOfferOrgState;
  /** The structured address's own problem (an event), or null. */
  readonly addressProblem: string | null;
  readonly editListingId: string | null;
  readonly photoCount: number;
  readonly subcategoryId: string | null | undefined;
  readonly recurrence: RideRecurrenceDraft | null;
  /** The recurrence of a new event; null for a single event, an edit or another kind. */
  readonly eventSeries: RideRecurrenceDraft | null;
  readonly houseNumbers: RideHouseNumbers;
}

export function firstListingProblem(i: ListingProblemInput): ListingFormProblem | null {
  const { t } = i;
  // Rides have no title field: it is derived from the route (#1411).
  if (!i.isRides && i.effectiveTitle.length < TITLE_MIN) {
    return { message: t('post.unifiedCreate.errors.titleRequired'), field: 'title' };
  }
  const missing = firstMissingRequiredField(i.specs, i.details);
  if (missing) {
    const message = t('post.unifiedCreate.errors.fieldRequired', { field: t(`marketplace.field.${missing.key}`) });
    return { message, field: detailField(missing.key) };
  }
  if (i.eventChoice.isOrgEvent && !i.eventChoice.orgId) return { message: t('eventPost.create.orgRequired'), field: 'org' };
  const jobOrgProblem = jobOfferOrgProblem(i.jobOfferOrg);
  if (jobOrgProblem) return { message: t(jobOrgProblem), field: 'org' };
  if (!i.isRides && !i.city) return { message: t('post.unifiedCreate.errors.cityRequired'), field: 'city' };
  if (i.addressProblem) return { message: i.addressProblem, field: 'city' };
  // An edit keeps the listing's photos and sub-category, so it passes neither and skips those rules.
  const creating = i.editListingId ? {} : { photoCount: i.photoCount, subcategoryId: i.subcategoryId };
  const rule = marketplaceRuleFieldError({ worldSlug: i.worldSlug, direction: i.direction, details: i.submitted, ...creating });
  if (rule) return { message: t(rule.key), field: fieldForRule(rule.code, i.submitted) };
  if (i.isRides && i.recurrence?.weekdays.length === 0) {
    return { message: t('rideSeries.errors.weekdaysRequired'), field: 'ride:recurrence' };
  }
  if (i.eventSeries?.weekdays.length === 0) return { message: t('postSeries.errors.weekdaysRequired'), field: null };
  if (i.eventSeries && !isEventSeriesDuration(i.submitted)) return { message: t('postSeries.errors.durationInvalid'), field: null };
  if (i.isRides && !i.recurrence && hasInvalidRideHouseNumber(i.houseNumbers)) {
    return { message: t('ridePlaces.houseNumberInvalid'), field: fieldForHouseNumbers(i.houseNumbers) };
  }
  const schemaErr = i.kind ? validateListingDetails(i.kind.detailSchema, i.submitted) : null;
  return schemaErr ? { message: t('marketplace.validationFailed', { code: schemaErr }), field: null } : null;
}
