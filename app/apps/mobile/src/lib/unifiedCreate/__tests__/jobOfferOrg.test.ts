// Mapped to spec: docs/spec/05_giving_worlds.md §5.11 (#1476) — the job offer's organization.
import { describe, expect, it } from 'vitest';
import {
  isJobOffer,
  jobOfferOrganizations,
  jobOfferOrgProblem,
  preselectedJobOfferOrgId,
  withJobOfferOrg,
  type JobOfferOrgState,
} from '../jobOfferOrg';

const ALLOWED = { orgId: 'o1', name: 'Employer', mayPostJobs: true };
const OTHER = { orgId: 'o2', name: 'Club', mayPostJobs: false };
const state = (patch: Partial<JobOfferOrgState> = {}): JobOfferOrgState => ({
  required: true,
  loaded: true,
  organizations: [ALLOWED],
  orgId: 'o1',
  ...patch,
});

describe('job offer organization', () => {
  it('applies only to the job offer of the employment world', () => {
    expect(isJobOffer('employment', 'job_offer')).toBe(true);
    expect(isJobOffer('employment', 'job_request')).toBe(false);
    expect(isJobOffer('time', 'job_offer')).toBe(false);
    expect(isJobOffer('employment', null)).toBe(false);
  });

  it('offers only organizations that may post jobs, and preselects a single one', () => {
    expect(jobOfferOrganizations([OTHER, ALLOWED])).toEqual([ALLOWED]);
    expect(preselectedJobOfferOrgId([ALLOWED])).toBe('o1');
    expect(preselectedJobOfferOrgId([])).toBeNull();
    expect(preselectedJobOfferOrgId([ALLOWED, { ...ALLOWED, orgId: 'o3' }])).toBeNull();
  });

  it('passes a job offer with an allowed organization and anything that is not a job offer', () => {
    expect(jobOfferOrgProblem(state())).toBeNull();
    expect(jobOfferOrgProblem(state({ required: false, organizations: [], orgId: null }))).toBeNull();
  });

  it('says no organization may post jobs only once the organizations loaded', () => {
    expect(jobOfferOrgProblem(state({ organizations: [], orgId: null }))).toBe('jobOffer.create.noEligibleOrg');
    expect(jobOfferOrgProblem(state({ loaded: false, organizations: [], orgId: null }))).toBe('jobOffer.create.orgRequired');
  });

  it('asks for an organization when none is picked or the picked one is not allowed', () => {
    expect(jobOfferOrgProblem(state({ organizations: [ALLOWED, { ...ALLOWED, orgId: 'o3' }], orgId: null }))).toBe(
      'jobOffer.create.orgRequired',
    );
    expect(jobOfferOrgProblem(state({ orgId: 'o2' }))).toBe('jobOffer.create.orgRequired');
  });

  it('submits the organization with a job offer only', () => {
    expect(withJobOfferOrg({ role: 'x' }, state())).toEqual({ role: 'x', org_id: 'o1' });
    expect(withJobOfferOrg({ role: 'x' }, state({ required: false }))).toEqual({ role: 'x' });
    expect(withJobOfferOrg({ role: 'x' }, state({ orgId: null }))).toEqual({ role: 'x' });
  });
});
