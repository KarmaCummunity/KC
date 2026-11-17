// FR-POST-001 AC6 — the first problem that blocks a listing publish, in section order.
import { describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';
// The series publisher pulls in the data layer; only its duration rule is read here.
vi.mock('../seriesPublish', () => ({ isEventSeriesDuration: () => true }));

import { TITLE_MIN, firstListingProblem, type ListingProblemInput } from '../firstListingProblem';

const t = ((key: string, o?: { field?: string }) => (o?.field ? `${key}:${o.field}` : key)) as unknown as TFunction;

/** A valid items-offer form: every rule passes, so each test breaks exactly one thing. */
const valid = (): ListingProblemInput => ({
  t, submitted: {}, worldSlug: 'time', direction: 'give', kind: null, specs: [], details: {},
  city: { id: '7000' }, effectiveTitle: 'A fine title', isRides: false, eventChoice: { isOrgEvent: false, orgId: null },
  jobOfferOrg: { required: false, loaded: true, organizations: [], orgId: null },
  addressProblem: null, editListingId: null, photoCount: 0, subcategoryId: undefined,
  recurrence: null, eventSeries: null, houseNumbers: {},
});

describe('firstListingProblem', () => {
  it('finds nothing wrong with a valid form', () => {
    expect(firstListingProblem(valid())).toBeNull();
  });

  it('asks for a title first, on the title field', () => {
    expect(firstListingProblem({ ...valid(), effectiveTitle: 'x'.repeat(TITLE_MIN - 1), city: null })).toEqual({
      message: 'post.unifiedCreate.errors.titleRequired', field: 'title',
    });
  });

  it('a ride has no title field: a short derived title is not a problem', () => {
    expect(firstListingProblem({ ...valid(), isRides: true, effectiveTitle: '', city: null, worldSlug: 'rides' })?.field).not.toBe('title');
  });

  it('asks for the organization of an organization event', () => {
    expect(firstListingProblem({ ...valid(), eventChoice: { isOrgEvent: true, orgId: null } })).toEqual({
      message: 'eventPost.create.orgRequired', field: 'org',
    });
  });

  it('asks for the organization of a job offer, or says none may post jobs (§5.11)', () => {
    const allowed = { orgId: 'o1', name: 'Employer', mayPostJobs: true };
    const jobOffer = (orgs: (typeof allowed)[], orgId: string | null) => ({
      ...valid(), jobOfferOrg: { required: true, loaded: true, organizations: orgs, orgId },
    });
    expect(firstListingProblem(jobOffer([allowed, { ...allowed, orgId: 'o2' }], null))).toEqual({
      message: 'jobOffer.create.orgRequired', field: 'org',
    });
    expect(firstListingProblem(jobOffer([], null))).toEqual({ message: 'jobOffer.create.noEligibleOrg', field: 'org' });
    expect(firstListingProblem(jobOffer([allowed], 'o1'))).toBeNull();
  });

  it('asks for a city on the city field, except for a ride', () => {
    expect(firstListingProblem({ ...valid(), city: null })).toEqual({ message: 'post.unifiedCreate.errors.cityRequired', field: 'city' });
    expect(firstListingProblem({ ...valid(), city: null, isRides: true, worldSlug: 'rides' })?.field).not.toBe('city');
  });

  it('reports the structured address problem on the city field, after the city itself', () => {
    expect(firstListingProblem({ ...valid(), addressProblem: 'street needed' })).toEqual({ message: 'street needed', field: 'city' });
    expect(firstListingProblem({ ...valid(), city: null, addressProblem: 'street needed' })?.message).toBe('post.unifiedCreate.errors.cityRequired');
  });

  // (worldSlug stays 'time' so the world's own route rules, tested elsewhere, do not answer first)
  it('a recurring ride needs weekdays, on the recurrence field', () => {
    const problem = firstListingProblem({ ...valid(), isRides: true, city: null, recurrence: { weekdays: [], endsOn: null } });
    expect(problem).toEqual({ message: 'rideSeries.errors.weekdaysRequired', field: 'ride:recurrence' });
  });

  it('a recurring event needs weekdays, with no single field at fault', () => {
    const problem = firstListingProblem({ ...valid(), eventSeries: { weekdays: [], endsOn: null } });
    expect(problem).toEqual({ message: 'postSeries.errors.weekdaysRequired', field: null });
  });
});
